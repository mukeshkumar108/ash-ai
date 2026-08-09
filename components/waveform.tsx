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

// Live waveform for recording: time-domain amplitude, mirrored symmetrically
// around the vertical centerline, smoothed with a peak follower so it reads as
// a centered, gently bobbing voice waveform rather than a left-weighted EQ.
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
      analyser.fftSize = 2048;
      data = new Uint8Array(analyser.fftSize);
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

      if (analyser) analyser.getByteTimeDomainData(data);

      const barCount = Math.max(16, Math.floor(w / (7 * dpr)));
      const gap = 2 * dpr;
      const barW = (w - gap * (barCount - 1)) / barCount;
      const midY = h / 2;
      const maxH = h - 6 * dpr;

      for (let i = 0; i < barCount; i++) {
        const index = Math.floor((i / barCount) * data.length);
        const raw = Math.abs(data[index] - 128) / 128;
        const previous = levels[i] ?? 0;
        // Fast attack, slow release keeps the bars floating smoothly.
        const level = raw > previous ? raw : Math.max(previous * 0.88, raw);
        levels[i] = level;

        const half = Math.max(2 * dpr, (level * maxH) / 2);
        const x = i * (barW + gap);
        const gradient = ctx.createLinearGradient(
          0,
          midY - half,
          0,
          midY + half,
        );
        gradient.addColorStop(0, 'rgba(168, 85, 247, 0.5)');
        gradient.addColorStop(0.5, '#d946ef');
        gradient.addColorStop(1, 'rgba(168, 85, 247, 0.5)');
        ctx.fillStyle = gradient;
        roundRectPath(
          ctx,
          x,
          midY - half,
          barW,
          half * 2,
          Math.max(0, Math.min(barW / 2, 2 * dpr)),
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

// Static peaks for a recorded/clip audio with a played-portion highlight.
// While `playing` with a `liveAnalyser`, the bars animate from the real
// audio instead of the static shape.
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
          liveAnalyser.fftSize = 2048;
          liveData = new Uint8Array(liveAnalyser.fftSize);
        }
        liveAnalyser.getByteTimeDomainData(liveData);
        const barCount = Math.min(
          liveData.length,
          Math.max(12, Math.floor(w / (7 * dpr))),
        );
        const gap = 2 * dpr;
        const barW = (w - gap * (barCount - 1)) / barCount;
        const midY = h / 2;
        const maxH = h - 6 * dpr;
        for (let i = 0; i < barCount; i++) {
          const index = Math.floor((i / barCount) * liveData.length);
          const raw = Math.abs(liveData[index] - 128) / 128;
          const half = Math.max(1.5 * dpr, (raw * maxH) / 2);
          const x = i * (barW + gap);
          ctx.fillStyle =
            x < playedTo
              ? '#d946ef'
              : 'hsl(var(--muted-foreground) / 0.35)';
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
        return;
      }

      if (peaks.length === 0) return;
      const barCount = Math.min(
        peaks.length,
        Math.max(12, Math.floor(w / (7 * dpr))),
      );
      const gap = 2 * dpr;
      const barW = (w - gap * (barCount - 1)) / barCount;
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
