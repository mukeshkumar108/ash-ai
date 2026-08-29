'use client';

import { Check, Loader2, Mic, RotateCcw, Trash2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { TranscriptReliability } from '@/lib/transcript-reliability';
import { motion } from 'framer-motion';
import { Button } from './ui/button';
import { LiveWaveform } from './waveform';
import {
  deleteVoiceRecording,
  latestVoiceRecordingForChat,
  saveVoiceRecording,
  type StoredVoiceRecording,
} from '@/lib/voice-recording-store';

const MAX_DURATION_SECONDS = 120;

function preferredMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  return (
    ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((type) =>
      MediaRecorder.isTypeSupported(type),
    ) ?? ''
  );
}

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function VoiceRecorder({
  chatId,
  disabled,
  onTranscript,
  containerRef,
}: {
  chatId: string;
  disabled: boolean;
  onTranscript: (result: {
    transcript: string;
    reliability: TranscriptReliability;
  }) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [pendingRecording, setPendingRecording] =
    useState<StoredVoiceRecording | null>(null);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(
    null,
  );

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => () => cleanupStream(), []);

  useEffect(() => {
    let active = true;
    void latestVoiceRecordingForChat(chatId)
      .then((recording) => {
        if (!active || !recording) return;
        setPendingRecording(recording);
        setTranscriptionError('Your voice note is saved and ready to retry.');
      })
      .catch(() => {
        // IndexedDB can be unavailable in private/locked-down browser modes.
        // Recording still works for the current page lifetime.
      });
    return () => {
      active = false;
    };
  }, [chatId]);

  const stopRecording = (cancel = false) => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    if (cancel) chunksRef.current = [];
    recorder.stop();
  };

  const startRecording = async () => {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      toast.error('Voice recording is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const audioCtx = new AudioCtx();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      source.connect(analyser);
      analyserRef.current = analyser;
      audioCtxRef.current = audioCtx;

      const mimeType = preferredMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      recorderRef.current = recorder;
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const chunks = chunksRef.current;
        setRecording(false);
        cleanupStream();
        if (chunks.length) {
          const blob = new Blob(chunks, {
            type: recorder.mimeType || chunks[0].type,
          });
          const recording: StoredVoiceRecording = {
            id: crypto.randomUUID(),
            chatId,
            blob,
            durationMs: Math.max(1, Date.now() - startedAtRef.current),
            createdAt: Date.now(),
          };
          setPendingRecording(recording);
          setTranscriptionError(null);
          void saveVoiceRecording(recording)
            .catch(() => {
              toast.warning(
                'This recording could not be saved across a refresh. Keep this page open while it transcribes.',
              );
            })
            .then(() => transcribe(recording));
        }
      };
      recorder.start(250);
      setSeconds(0);
      setRecording(true);
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_DURATION_SECONDS) stopRecording();
      }, 250);
    } catch {
      cleanupStream();
      toast.error('Microphone access was not granted.');
    }
  };

  const transcribe = async (recording: StoredVoiceRecording) => {
    setTranscribing(true);
    setTranscriptionError(null);
    try {
      const body = new FormData();
      body.append(
        'file',
        recording.blob,
        recording.blob.type.includes('mp4')
          ? 'voice-note.m4a'
          : 'voice-note.webm',
      );
      body.append('durationMs', String(recording.durationMs));
      body.append('chatId', chatId);
      body.append('recordingId', recording.id);
      const response = await fetch('/api/voice/transcribe', {
        method: 'POST',
        body,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(payload.error || 'Transcription failed.');
      onTranscript({
        transcript: payload.transcript,
        reliability: payload.reliability,
      });
      setPendingRecording(null);
      await deleteVoiceRecording(recording.id).catch(() => {});
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Transcription failed.';
      setTranscriptionError(message);
      toast.error(`${message} Your recording is saved—tap retry.`);
    } finally {
      setTranscribing(false);
    }
  };

  const discardPendingRecording = async () => {
    const recording = pendingRecording;
    setPendingRecording(null);
    setTranscriptionError(null);
    if (recording) await deleteVoiceRecording(recording.id).catch(() => {});
  };

  if (recording || transcribing || pendingRecording) {
    const pill = (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        data-testid={
          recording ? 'voice-recording-state' : 'voice-transcribing-state'
        }
        className="absolute inset-0 z-20 flex items-center gap-2 rounded-2xl border border-fuchsia-500/20 bg-background/95 px-3 backdrop-blur"
      >
        {recording ? (
          <>
            <div className="min-w-0 flex-1">
              <LiveWaveform analyser={analyserRef.current} />
            </div>

            <span className="min-w-12 shrink-0 text-center text-xs tabular-nums text-red-500">
              {formatTime(seconds)}
            </span>

            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 shrink-0 rounded-full"
              aria-label="Discard recording"
              onClick={() => stopRecording(true)}
            >
              <X size={18} />
            </Button>

            <Button
              type="button"
              size="icon"
              className="size-8 shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
              aria-label="Accept recording"
              onClick={() => stopRecording()}
            >
              <Check size={18} />
            </Button>
          </>
        ) : transcribing ? (
          <div className="flex w-full items-center justify-center gap-2 py-1 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            Transcribing…
          </div>
        ) : (
          <div className="flex w-full items-center gap-2 py-1">
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {transcriptionError || 'Voice note saved.'}
            </span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 shrink-0 rounded-full"
              aria-label="Discard saved recording"
              onClick={() => void discardPendingRecording()}
            >
              <Trash2 size={16} />
            </Button>
            <Button
              type="button"
              size="icon"
              className="size-8 shrink-0 rounded-full"
              aria-label="Retry transcription"
              onClick={() => {
                if (pendingRecording) void transcribe(pendingRecording);
              }}
            >
              <RotateCcw size={16} />
            </Button>
          </div>
        )}
      </motion.div>
    );
    return createPortal(pill, containerRef.current ?? document.body);
  }

  return (
    <Button
      data-testid="voice-record-button"
      type="button"
      size="icon"
      variant="ghost"
      className="size-8 rounded-full"
      aria-label="Record voice note"
      disabled={disabled}
      onClick={startRecording}
    >
      <Mic size={17} />
    </Button>
  );
}
