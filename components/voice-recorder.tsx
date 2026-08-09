'use client';

import { Mic, Pause, Play, Send, Square, Trash2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
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

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.max(0, r);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

// Live amplitude bars drawn from the MediaStream's analyser node while
// recording. Full-width so the composer "fills up" as the user speaks.
function LiveWaveform({ stream }: { stream: MediaStream }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let data: Uint8Array | null = null;
    let raf = 0;
    let cancelled = false;

    const draw = () => {
      if (cancelled) return;
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      if (analyser && data) {
        analyser.getByteFrequencyData(data);
      }

      const barCount = Math.max(16, Math.floor(w / (7 * dpr)));
      const gap = 2 * dpr;
      const barW = (w - gap * (barCount - 1)) / barCount;

      for (let i = 0; i < barCount; i++) {
        let value = 0;
        if (analyser && data) {
          const index = Math.floor((i / barCount) * data.length);
          value = data[index] / 255;
        }
        const barHeight = Math.max(4 * dpr, value * (h - 8 * dpr));
        const x = i * (barW + gap);
        const y = (h - barHeight) / 2;
        const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
        gradient.addColorStop(0, '#e879f9');
        gradient.addColorStop(1, '#a855f7');
        ctx.fillStyle = gradient;
        roundRectPath(
          ctx,
          x,
          y,
          barW,
          barHeight,
          Math.min(barW / 2, 3 * dpr),
        );
        ctx.fill();
      }
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(canvas.clientWidth * dpr);
      canvas.height = Math.floor(canvas.clientHeight * dpr);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const init = async () => {
      try {
        const AudioCtx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        audioCtx = new AudioCtx();
        // Mobile Safari starts contexts suspended under autoplay policy; the
        // analyser would otherwise read silence and the bars would stay flat.
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
        const source = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.82;
        source.connect(analyser);
        data = new Uint8Array(analyser.frequencyBinCount);
      } catch {
        // Audio analysis unavailable; the bars stay flat.
      }
      draw();
    };

    void init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      void audioCtx?.close().catch(() => {});
    };
  }, [stream]);

  return <canvas ref={canvasRef} className="h-10 w-full" aria-hidden />;
}

// Static waveform for a recorded note: muted bars with the played portion
// highlighted in the brand accent. Tap/drag to seek.
function PeakWaveform({
  peaks,
  progress,
  onSeek,
}: {
  peaks: number[];
  progress: number;
  onSeek?: (fraction: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const drawRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      if (peaks.length === 0 || w <= 0) return;

      // Adapt the bar count to the rendered width so bars never collapse to a
      // negative width on narrow (mobile) canvases.
      const barCount = Math.min(
        peaks.length,
        Math.max(12, Math.floor(w / (7 * dpr))),
      );
      const gap = 2 * dpr;
      const barW = (w - gap * (barCount - 1)) / barCount;
      const playedTo = progressRef.current * w;

      for (let i = 0; i < barCount; i++) {
        const sourceIndex = Math.min(
          peaks.length - 1,
          Math.floor((i / barCount) * peaks.length),
        );
        const value = Math.min(1, Math.max(0, peaks[sourceIndex]));
        const barHeight = Math.max(3 * dpr, value * (h - 6 * dpr));
        const x = i * (barW + gap);
        const y = (h - barHeight) / 2;
        ctx.fillStyle =
          x < playedTo
            ? '#d946ef'
            : 'hsl(var(--muted-foreground) / 0.35)';
        roundRectPath(
          ctx,
          x,
          y,
          barW,
          barHeight,
          Math.max(0, Math.min(barW / 2, 2 * dpr)),
        );
        ctx.fill();
      }
    };
    drawRef.current = draw;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(canvas.clientWidth * dpr);
      canvas.height = Math.floor(canvas.clientHeight * dpr);
      draw();
    };
    const observer = new ResizeObserver(resize);
    resize();
    observer.observe(canvas);

    return () => {
      observer.disconnect();
    };
  }, [peaks]);

  useEffect(() => {
    drawRef.current();
  }, [progress]);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!onSeek) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const fraction = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width),
    );
    onSeek(fraction);
  };

  return (
    <canvas
      ref={canvasRef}
      className="h-10 w-full cursor-pointer"
      onPointerDown={handlePointerDown}
      role="slider"
      aria-label="Audio seek bar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      tabIndex={0}
      onKeyDown={(event) => {
        if (!onSeek) return;
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          onSeek(Math.min(1, progress + 0.05));
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          onSeek(Math.max(0, progress - 0.05));
        }
      }}
    />
  );
}

async function computePeaks(blob: Blob, barCount = 80): Promise<number[]> {
  try {
    const buffer = await blob.arrayBuffer();
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const audioCtx = new AudioCtx();
    const audioBuffer = await audioCtx.decodeAudioData(buffer);
    const samples = audioBuffer.getChannelData(0);
    const blockSize = Math.max(1, Math.floor(samples.length / barCount));
    const peaks: number[] = [];
    for (let i = 0; i < barCount; i++) {
      let min = 1;
      let max = -1;
      for (let j = 0; j < blockSize; j++) {
        const value = samples[i * blockSize + j];
        if (value < min) min = value;
        if (value > max) max = value;
      }
      peaks.push(Math.min(1, Math.max(Math.abs(min), Math.abs(max))));
    }
    void audioCtx.close().catch(() => {});
    return peaks;
  } catch {
    return [];
  }
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
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [note, setNote] = useState<{
    blob: Blob;
    durationMs: number;
    url: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
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

  // Playback lifecycle + waveform peaks for the recorded note.
  useEffect(() => {
    if (!note) {
      setPeaks([]);
      setPlaybackTime(0);
      setIsPlaying(false);
      return;
    }

    const audio = new Audio(note.url);
    audioRef.current = audio;
    const onTime = () => setPlaybackTime(audio.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setPlaybackTime(0);
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    void computePeaks(note.blob).then(setPeaks);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audioRef.current = null;
    };
  }, [note]);

  const clearNote = () => {
    audioRef.current?.pause();
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
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      streamRef.current = mediaStream;
      setStream(mediaStream);
      const mimeType = preferredMimeType();
      const recorder = new MediaRecorder(
        mediaStream,
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

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  };

  const seekTo = (fraction: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (Number.isFinite(audio.duration)) {
      audio.currentTime = fraction * audio.duration;
    }
    setPlaybackTime(fraction * (note?.durationMs ?? 0) / 1000);
  };

  if (recording) {
    const takeover = (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        data-testid="voice-recording-state"
        className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-40 mx-auto flex w-full max-w-3xl items-center gap-3 rounded-2xl border border-fuchsia-500/20 bg-background/90 px-3 py-2 shadow-lg backdrop-blur md:bottom-6"
      >
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-9 shrink-0 rounded-full"
          aria-label="Cancel recording"
          onClick={() => stopRecording(true)}
        >
          <X size={18} />
        </Button>

        <div className="min-w-0 flex-1">
          {stream ? <LiveWaveform stream={stream} /> : null}
        </div>

        <span className="min-w-12 shrink-0 text-center text-xs tabular-nums text-red-500">
          {formatTime(seconds)}
        </span>

        <Button
          type="button"
          size="icon"
          className="size-9 shrink-0 rounded-full bg-red-500 text-white hover:bg-red-600"
          aria-label="Stop and review recording"
          onClick={() => stopRecording()}
        >
          <Square size={14} fill="currentColor" />
        </Button>
      </motion.div>
    );
    return createPortal(takeover, document.body);
  }

  if (note) {
    const duration = Math.max(1, note.durationMs) / 1000;
    const progress = Math.min(1, playbackTime / duration);
    const takeover = (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        data-testid="voice-note-preview"
        className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-40 mx-auto flex w-full max-w-3xl items-center gap-3 rounded-2xl border bg-background/90 px-3 py-2 shadow-lg backdrop-blur md:bottom-6"
      >
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-9 shrink-0 rounded-full"
          aria-label={isPlaying ? 'Pause playback' : 'Play recording'}
          onClick={togglePlay}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </Button>

        <div className="min-w-0 flex-1">
          <PeakWaveform peaks={peaks} progress={progress} onSeek={seekTo} />
        </div>

        <span className="min-w-12 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
          {formatTime(playbackTime)}/{formatTime(duration)}
        </span>

        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-9 shrink-0 rounded-full"
          aria-label="Discard voice note"
          onClick={clearNote}
          disabled={uploading}
        >
          <Trash2 size={16} />
        </Button>

        <Button
          type="button"
          size="icon"
          className="size-9 shrink-0 rounded-full"
          aria-label="Send voice note"
          onClick={sendNote}
          disabled={uploading}
        >
          {uploading ? (
            <span className="animate-spin text-xs">…</span>
          ) : (
            <Send size={15} />
          )}
        </Button>
      </motion.div>
    );
    return createPortal(takeover, document.body);
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
