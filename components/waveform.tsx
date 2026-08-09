'use client';

import { useEffect, useRef } from 'react';

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

// Draws symmetric bars mirrored around the vertical centerline. `values` are
// 0..1 amplitudes; bars before `playedTo` (x pixels) render in the brand
// accent, the rest in the muted tone.
function drawCenteredBars(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  w: number,
  h: number,
  values: number[],
  playedTo: number,
  minHalf: number,
) {
  if (w <= 0 || h <= 0 || values.length === 0) return;
  const gap = 2 * dpr;
  const barCount = values.length;
  const barW = (w - gap * (barCount - 1)) / barCount;
  if (barW <= 0) return;
  const midY = h / 2;
  const maxH = h - 6 * dpr;
  for (let i = 0; i < barCount; i++) {
    const value = Math.min(1, Math.max(0, values[i]));
    const half = Math.max(minHalf, (value * maxH) / 2);
    const x = i * (barW + gap);
    ctx.fillStyle =
      x < playedTo ? '#d946ef' : 'hsl(var(--muted-foreground) / 0.35)';
    roundRectPath(
      ctx,
      x,
      midY - half,
      barW,
      half * 2,
      Math.max(0, Math.min(barW / 2, 1.5 * dpr)),
    );
    ctx.fill();
  }
}

// Live waveform while recording: frequency data mapped onto a log scale so the
// voice energy spreads across the full width, smoothed with a slow
// attack/release envelope so the bars swell and settle at a calm, human pace
// rather than flickering frame-to-frame.
export function LiveWaveform({
  analyser,
  className,
}: {
  analyser: AnalyserNode | null;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let data: Uint8Array | null = null;
    if (analyser) {
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.85;
      data = new Uint8Array(analyser.frequencyBinCount);
    }
    const levels: number[] = [];
    let raf = 0;
    let cancelled = false;

    const draw = () => {
      if (cancelled) return;
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      if (!data) return;

      if (analyser) analyser.getByteFrequencyData(data);

      const barCount = Math.max(16, Math.floor(w / (8 * dpr)));
      const values: number[] = [];
      for (let i = 0; i < barCount; i++) {
        const t = i / (barCount - 1);
        const index = Math.max(1, Math.floor(Math.pow(data.length - 1, t)));
        const raw = data[Math.min(data.length - 1, index)] / 255;
        const previous = levels[i] ?? 0;
        const factor = raw > previous ? 0.22 : 0.06;
        const level = previous + (raw - previous) * factor;
        levels[i] = level;
        values.push(level);
      }

      drawCenteredBars(ctx, dpr, w, h, values, Infinity, 2 * dpr);
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(canvas.clientWidth * dpr);
      canvas.height = Math.floor(canvas.clientHeight * dpr);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    draw();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [analyser]);

  return (
    <canvas
      ref={canvasRef}
      className={className ?? 'h-10 w-full'}
      aria-hidden
    />
  );
}

// Waveform for a recorded/loaded clip: static peaks with a played-portion
// highlight. While `playing` with a `liveAnalyser`, the bars animate from the
// real audio (same log-spaced, smoothed envelope as the recorder).
export function PeakWaveform({
  peaks,
  progress,
  onSeek,
  liveAnalyser,
  playing,
  className,
}: {
  peaks: number[];
  progress: number;
  onSeek?: (fraction: number) => void;
  liveAnalyser?: AnalyserNode | null;
  playing?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const drawRef = useRef<() => void>(() => {});
  const liveLevelsRef = useRef<number[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let liveData: Uint8Array | null = null;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      if (w <= 0 || h <= 0) return;

      const playedTo = progressRef.current * w;
      const isLive = playing && liveAnalyser;

      if (isLive) {
        if (!liveData) {
          liveAnalyser.fftSize = 256;
          liveAnalyser.smoothingTimeConstant = 0.85;
          liveData = new Uint8Array(liveAnalyser.frequencyBinCount);
        }
        liveAnalyser.getByteFrequencyData(liveData);
        const barCount = Math.max(12, Math.floor(w / (8 * dpr)));
        const levels = liveLevelsRef.current;
        const values: number[] = [];
        for (let i = 0; i < barCount; i++) {
          const t = i / (barCount - 1);
          const index = Math.max(1, Math.floor(Math.pow(liveData.length - 1, t)));
          const raw = liveData[Math.min(liveData.length - 1, index)] / 255;
          const previous = levels[i] ?? 0;
          const factor = raw > previous ? 0.22 : 0.06;
          const level = previous + (raw - previous) * factor;
          levels[i] = level;
          values.push(level);
        }
        drawCenteredBars(ctx, dpr, w, h, values, playedTo, 1.5 * dpr);
        return;
      }

      if (peaks.length === 0) return;
      const barCount = Math.min(
        peaks.length,
        Math.max(12, Math.floor(w / (8 * dpr))),
      );
      const values: number[] = [];
      for (let i = 0; i < barCount; i++) {
        const sourceIndex = Math.min(
          peaks.length - 1,
          Math.floor((i / barCount) * peaks.length),
        );
        values.push(peaks[sourceIndex]);
      }
      drawCenteredBars(ctx, dpr, w, h, values, playedTo, 1.5 * dpr);
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
  }, [peaks, playing, liveAnalyser]);

  useEffect(() => {
    drawRef.current();
  }, [progress, playing]);

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
      className={className ?? 'h-10 w-full cursor-pointer'}
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

export async function computePeaks(
  blob: Blob,
  barCount = 80,
): Promise<number[]> {
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
