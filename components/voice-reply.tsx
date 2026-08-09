'use client';

import { Pause, Play, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { computePeaks, PeakWaveform } from './waveform';

function formatTime(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function VoiceReply({
  chatId,
  messageId,
  autoGenerate,
}: { chatId: string; messageId: string; autoGenerate: boolean }) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const generate = async () => {
    if (loading || audioUrl) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/voice/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, messageId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Voice reply unavailable.');
      }
      const blob = await response.blob();
      setAudioBlob(blob);
      setAudioUrl(URL.createObjectURL(blob));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Voice reply unavailable.',
      );
    } finally {
      setLoading(false);
    }
  };

  // Playback lifecycle + static peaks for the waveform.
  useEffect(() => {
    if (!audioUrl) return;
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    const onTime = () => {
      setTime(audio.currentTime);
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setTime(0);
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    if (audioBlob) void computePeaks(audioBlob).then(setPeaks);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audioRef.current = null;
      void audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      analyserRef.current = null;
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl, audioBlob]);

  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );

  // Live analyser so the waveform animates while actually playing. Created
  // lazily on the first play (user gesture), and routed to the speakers so
  // the audio stays audible.
  const ensureAnalyser = () => {
    const audio = audioRef.current;
    if (!audio || analyserRef.current) return;
    try {
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') void ctx.resume();
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      source.connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
    } catch {
      // Fall back to the static waveform if analysis is unavailable.
    }
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      ensureAnalyser();
      void audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  };

  const seekTo = (fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) {
      return;
    }
    audio.currentTime = fraction * audio.duration;
    setTime(audio.currentTime);
  };

  if (audioUrl) {
    const progress = duration > 0 ? Math.min(1, time / duration) : 0;
    return (
      <div
        data-testid="voice-reply-audio"
        className="flex w-full max-w-72 items-center gap-2 rounded-2xl border bg-muted/40 px-2 py-1.5"
      >
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 rounded-full"
          aria-label={playing ? 'Pause voice reply' : 'Play voice reply'}
          onClick={togglePlay}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </Button>
        <div className="min-w-0 flex-1">
          <PeakWaveform
            peaks={peaks}
            progress={progress}
            onSeek={seekTo}
            liveAnalyser={analyserRef.current}
            playing={playing}
          />
        </div>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {formatTime(time)}/{formatTime(duration)}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 rounded-full"
        onClick={generate}
        disabled={loading}
      >
        <Volume2 size={14} className="mr-1.5" />
        {loading ? 'Making voice…' : 'Listen'}
      </Button>
      {error ? (
        <span role="status">{error} Text is still available.</span>
      ) : null}
    </div>
  );
}
