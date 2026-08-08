'use client';

import { Mic, Send, Square, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from './ui/button';

const MAX_DURATION_SECONDS = 120;

function preferredMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  return (
    ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((type) =>
      MediaRecorder.isTypeSupported(type),
    ) ?? ''
  );
}

export function VoiceRecorder({
  disabled,
  onTranscript,
}: {
  disabled: boolean;
  onTranscript: (transcript: string) => void;
}) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [note, setNote] = useState<{
    blob: Blob;
    durationMs: number;
    url: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(
    () => () => {
      cleanupStream();
      if (note) URL.revokeObjectURL(note.url);
    },
    [note],
  );

  const clearNote = () => {
    if (note) URL.revokeObjectURL(note.url);
    setNote(null);
    setSeconds(0);
  };

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
      clearNote();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
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
        const durationMs = Math.max(1, Date.now() - startedAtRef.current);
        const chunks = chunksRef.current;
        if (chunks.length) {
          const blob = new Blob(chunks, {
            type: recorder.mimeType || chunks[0].type,
          });
          setNote({ blob, durationMs, url: URL.createObjectURL(blob) });
        }
        setRecording(false);
        cleanupStream();
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

  const sendNote = async () => {
    if (!note) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append(
        'file',
        note.blob,
        note.blob.type.includes('mp4') ? 'voice-note.m4a' : 'voice-note.webm',
      );
      body.append('durationMs', String(note.durationMs));
      const response = await fetch('/api/voice/transcribe', {
        method: 'POST',
        body,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(payload.error || 'Transcription failed.');
      onTranscript(payload.transcript);
      clearNote();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Transcription failed.',
      );
    } finally {
      setUploading(false);
    }
  };

  if (recording) {
    return (
      <div
        className="flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2"
        data-testid="voice-recording-state"
      >
        <span className="min-w-10 text-center text-xs tabular-nums text-red-600">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
        </span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 rounded-full"
          aria-label="Cancel recording"
          onClick={() => stopRecording(true)}
        >
          <X size={15} />
        </Button>
        <Button
          type="button"
          size="icon"
          className="size-8 rounded-full"
          aria-label="Stop recording"
          onClick={() => stopRecording()}
        >
          <Square size={13} fill="currentColor" />
        </Button>
      </div>
    );
  }

  if (note) {
    return (
      <div
        className="flex items-center gap-1 rounded-full border bg-background/90 px-1.5 py-1"
        data-testid="voice-note-preview"
      >
        <audio
          className="h-8 max-w-36 sm:max-w-52"
          controls
          preload="metadata"
          src={note.url}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 rounded-full"
          aria-label="Discard voice note"
          onClick={clearNote}
          disabled={uploading}
        >
          <Trash2 size={15} />
        </Button>
        <Button
          type="button"
          size="icon"
          className="size-8 rounded-full"
          aria-label="Send voice note"
          onClick={sendNote}
          disabled={uploading}
        >
          {uploading ? (
            <span className="animate-pulse text-xs">…</span>
          ) : (
            <Send size={15} />
          )}
        </Button>
      </div>
    );
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
