'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Clapperboard,
  ImagePlus,
  Loader2,
  Music,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  calculateVideoGemCost,
  getVideoModelById,
  videoModels,
} from '@/lib/ai/video-models';
import { getBlobDisplayUrl } from '@/lib/blob';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type UploadedFile = {
  url: string;
  pathname: string;
  contentType: string;
  name: string;
  dataUri?: string;
};

type GeneratedVideo = {
  url: string;
  pathname: string;
  mediaType: string;
};

type VideoGen = {
  id: string;
  modelId: string;
  prompt: string;
  status: 'loading' | 'done' | 'failed';
  error?: string;
  videos: GeneratedVideo[];
  createdAt: number;
  duration?: number;
  resolution?: string;
  draft?: boolean;
};

const createId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `gen-${Date.now()}`;

function durationOptions(modelId: string) {
  return modelId === 'xai/grok-imagine-video' ? [3, 5] : [3, 5, 7, 10];
}

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export default function VideoStudioPage() {
  const [selectedModelId, setSelectedModelId] = useState(videoModels[0].id);
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(videoModels[0].capabilities.durations.default);
  const [resolution, setResolution] = useState(
    videoModels[0].capabilities.resolutions[0],
  );
  const [draft, setDraft] = useState(true);
  const [startImage, setStartImage] = useState<UploadedFile | null>(null);
  const [endFrame, setEndFrame] = useState<UploadedFile | null>(null);
  const [audioFile, setAudioFile] = useState<UploadedFile | null>(null);
  const [uploading, setUploading] = useState<'start' | 'end' | 'audio' | null>(
    null,
  );
  const [generations, setGenerations] = useState<VideoGen[]>([]);

  const startInputRef = useRef<HTMLInputElement>(null);
  const endInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const model =
    getVideoModelById(selectedModelId) ?? videoModels[0];

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch('/api/video/list');
        if (!response.ok) return;
        const payload = await response.json();
        const rows: VideoGen[] = (payload.videos ?? []).map(
          (row: {
            id: string;
            modelId: string;
            prompt: string;
            videos: GeneratedVideo[];
            createdAt: string;
          }) => ({
            id: row.id,
            modelId: row.modelId,
            prompt: row.prompt,
            status: 'done' as const,
            videos: row.videos,
            createdAt: new Date(row.createdAt).getTime() || 0,
          }),
        );
        if (!cancelled) setGenerations(rows);
      } catch {
        // leave empty on failure
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectModel = (nextId: string) => {
    setSelectedModelId(nextId);
    const next = getVideoModelById(nextId) ?? videoModels[0];
    setDuration(next.capabilities.durations.default);
    setResolution(next.capabilities.resolutions[0]);
    setDraft(next.capabilities.draft);
    if (!next.capabilities.supportsEndFrame) setEndFrame(null);
    if (!next.capabilities.supportsAudio) setAudioFile(null);
  };

  const uploadFile = useCallback(async (file: File): Promise<UploadedFile> => {
    const form = new FormData();
    form.append('file', file, file.name);
    const response = await fetch('/api/files/upload', {
      method: 'POST',
      body: form,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || 'Upload failed');
    }
    return {
      url: payload.url,
      pathname: payload.pathname,
      contentType: payload.contentType,
      name: file.name,
    };
  }, []);

  const handleStartImage = async (file: File | undefined) => {
    if (!file) return;
    setUploading('start');
    try {
      const uploaded = await uploadFile(file);
      uploaded.dataUri = await fileToDataUri(file);
      setStartImage(uploaded);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not upload start image',
      );
    } finally {
      setUploading(null);
    }
  };

  const handleEndFrame = async (file: File | undefined) => {
    if (!file) return;
    setUploading('end');
    try {
      const uploaded = await uploadFile(file);
      uploaded.dataUri = await fileToDataUri(file);
      setEndFrame(uploaded);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not upload end frame',
      );
    } finally {
      setUploading(null);
    }
  };

  const handleAudio = async (file: File | undefined) => {
    if (!file) return;
    setUploading('audio');
    try {
      setAudioFile(await uploadFile(file));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not upload audio',
      );
    } finally {
      setUploading(null);
    }
  };

  const gemCost = useMemo(
    () => calculateVideoGemCost(model, duration, resolution, draft),
    [model, duration, resolution, draft],
  );

  const isGenerating = generations.some((gen) => gen.status === 'loading');

  const generate = useCallback(async () => {
    if (!prompt.trim()) {
      toast.error('Enter a prompt first');
      return;
    }
    if (!startImage) {
      toast.error('Add a start image first');
      return;
    }

    const id = createId();
    const gen: VideoGen = {
      id,
      modelId: model.id,
      prompt: prompt.trim(),
      status: 'loading',
      videos: [],
      createdAt: Date.now(),
      duration,
      resolution,
      draft,
    };
    setGenerations((current) => [gen, ...current]);

    try {
      const response = await fetch('/api/video/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: id,
          modelId: model.id,
          prompt: prompt.trim(),
          startImagePathname: startImage.pathname,
          endFramePathname: endFrame?.pathname ?? undefined,
          audioPathname: audioFile?.pathname ?? undefined,
          duration,
          resolution,
          draft,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Generation failed');
      }
      setGenerations((current) =>
        current.map((g) =>
          g.id === id ? { ...g, status: 'done', videos: payload.results } : g,
        ),
      );
      window.dispatchEvent(new Event('gems:changed'));
    } catch (error) {
      setGenerations((current) =>
        current.map((g) =>
          g.id === id
            ? {
                ...g,
                status: 'failed',
                error: error instanceof Error ? error.message : 'Generation failed',
              }
            : g,
        ),
      );
      toast.error(error instanceof Error ? error.message : 'Generation failed');
      window.dispatchEvent(new Event('gems:changed'));
    }
  }, [prompt, startImage, endFrame, audioFile, model, duration, resolution, draft]);

  const deleteVideo = useCallback(async (gen: VideoGen) => {
    setGenerations((current) => current.filter((g) => g.id !== gen.id));
    try {
      for (const video of gen.videos) {
        await fetch(`/api/files?pathname=${encodeURIComponent(video.pathname)}`, {
          method: 'DELETE',
        });
      }
      await fetch(`/api/video/generation/${gen.id}`, { method: 'DELETE' });
    } catch {
      // best-effort cleanup
    }
  }, []);

  const loadingGens = generations.filter((gen) => gen.status === 'loading');
  const failedGens = generations.filter((gen) => gen.status === 'failed');
  const doneGens = generations.filter((gen) => gen.status === 'done');

  const imageUploadSlot = ({
    label,
    value,
    onRemove,
    onPick,
    uploading,
  }: {
    label: string;
    value: UploadedFile | null;
    onRemove: () => void;
    onPick: () => void;
    uploading: boolean;
  }) => (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {value ? (
        <div className="relative flex items-center gap-2 rounded-lg border bg-muted/30 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value.dataUri}
            alt={label}
            className="h-16 w-16 rounded-md border object-cover"
          />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {value.name}
          </span>
          <button
            type="button"
            aria-label={`Remove ${label.toLowerCase()}`}
            onClick={onRemove}
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-900/70 text-white"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onPick}
          disabled={uploading}
          className="flex h-16 items-center justify-center gap-2 rounded-lg border border-dashed text-xs text-muted-foreground hover:bg-muted/50"
        >
          {uploading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <>
              <ImagePlus size={14} />
              {label}
            </>
          )}
        </button>
      )}
    </div>
  );

  const audioUploadSlot = ({
    label,
    value,
    onRemove,
    onPick,
    uploading,
  }: {
    label: string;
    value: UploadedFile | null;
    onRemove: () => void;
    onPick: () => void;
    uploading: boolean;
  }) => (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {value ? (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2">
          <Music size={14} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {value.name}
          </span>
          <button
            type="button"
            aria-label="Remove audio"
            onClick={onRemove}
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-900/70 text-white"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onPick}
          disabled={uploading}
          className="flex h-10 items-center justify-center gap-2 rounded-lg border border-dashed text-xs text-muted-foreground hover:bg-muted/50"
        >
          {uploading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <>
              <Music size={14} />
              {label}
            </>
          )}
        </button>
      )}
    </div>
  );

  return (
    <div className="flex min-h-dvh w-full flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Video Studio</h1>
        <p className="text-sm text-muted-foreground">
          Generate short videos with Replicate models. Start image required.
        </p>
      </div>

      <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
        {/* Controls column */}
        <div className="flex w-full shrink-0 flex-col gap-4 md:sticky md:top-6 md:w-80">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Model
            </span>
            <Select value={selectedModelId} onValueChange={selectModel}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {videoModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{model.description}</p>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4">
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={
                model.id === 'xai/grok-imagine-video'
                  ? 'Describe the motion — what should happen in the video…'
                  : 'Describe the video you want to generate…'
              }
              className="min-h-24 bg-background"
            />

            {imageUploadSlot({
              label: 'Start image (required)',
              value: startImage,
              onRemove: () => setStartImage(null),
              onPick: () => startInputRef.current?.click(),
              uploading: uploading === 'start',
            })}

            {model.capabilities.supportsEndFrame &&
              imageUploadSlot({
                label: 'End frame image (optional)',
                value: endFrame,
                onRemove: () => setEndFrame(null),
                onPick: () => endInputRef.current?.click(),
                uploading: uploading === 'end',
              })}

            {model.capabilities.supportsAudio &&
              audioUploadSlot({
                label: 'Audio (optional)',
                value: audioFile,
                onRemove: () => setAudioFile(null),
                onPick: () => audioInputRef.current?.click(),
                uploading: uploading === 'audio',
              })}

            <div className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-xs text-muted-foreground">
                Duration
              </span>
              <Select
                value={String(duration)}
                onValueChange={(value) => setDuration(Number(value))}
              >
                <SelectTrigger className="h-8 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {durationOptions(model.id).map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d}s
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-xs text-muted-foreground">
                Quality
              </span>
              <Select value={resolution} onValueChange={setResolution}>
                <SelectTrigger className="h-8 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {model.capabilities.resolutions.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                      {r === '720p' ? ' (default)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {model.capabilities.draft && (
              <div className="flex cursor-pointer items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>Draft mode (4x faster preview)</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft}
                  aria-label="Toggle draft mode"
                  onClick={() => setDraft((current) => !current)}
                  className={cn(
                    'relative h-5 w-9 shrink-0 rounded-full transition-colors',
                    draft ? 'bg-primary' : 'bg-muted-foreground/30',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 size-4 rounded-full bg-white transition-transform',
                      draft ? 'left-[18px]' : 'left-0.5',
                    )}
                  />
                </button>
              </div>
            )}

            <Button
              type="button"
              onClick={generate}
              disabled={isGenerating || !prompt.trim() || !startImage}
            >
              {isGenerating ? (
                <>
                  <Loader2 size={14} className="mr-1 animate-spin" />
                  Generating…
                </>
              ) : (
                `Generate · ${gemCost} gems`
              )}
            </Button>
          </div>
        </div>

        {/* Results column */}
        <div className="min-w-0 flex-1">
          {generations.length === 0 ? (
            <div className="flex h-48 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
              Generated videos will appear here
            </div>
          ) : (
            <>
              {failedGens.length > 0 && (
                <div className="mb-4 flex flex-col gap-2">
                  {failedGens.map((gen) => (
                    <div
                      key={gen.id}
                      className="flex items-start justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600"
                    >
                      <span>{gen.error ?? 'Generation failed'}</span>
                      <button
                        type="button"
                        aria-label="Dismiss failed generation"
                        onClick={() =>
                          setGenerations((current) =>
                            current.filter((item) => item.id !== gen.id),
                          )
                        }
                        className="flex size-6 shrink-0 items-center justify-center rounded-full text-red-600/70 hover:bg-red-500/10 hover:text-red-700"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {loadingGens.length > 0 && (
                <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {loadingGens.map((gen) => (
                    <div
                      key={gen.id}
                      data-testid="video-skeleton"
                      className="overflow-hidden rounded-xl border"
                    >
                      <div className="image-shimmer relative aspect-video bg-muted/60">
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
                          <Loader2
                            size={20}
                            className="animate-spin text-muted-foreground"
                          />
                          <span className="text-xs font-medium text-muted-foreground">
                            Generating {gen.duration}s{' '}
                            {gen.resolution && gen.resolution !== '720p'
                              ? gen.resolution
                              : ''}
                            {gen.draft ? ' draft' : ''}
                          </span>
                          <span className="line-clamp-2 text-xs text-muted-foreground/80">
                            {gen.prompt}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {doneGens.length > 0 && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {doneGens.map((gen) => {
                    const modelInfo = getVideoModelById(gen.modelId);
                    return (
                      <div
                        key={gen.id}
                        className="group overflow-hidden rounded-xl border"
                      >
                        <div className="relative bg-black">
                          <video
                            controls
                            preload="metadata"
                            className="aspect-video w-full object-contain"
                            src={
                              gen.videos[0]
                                ? getBlobDisplayUrl(gen.videos[0].url)
                                : undefined
                            }
                          />
                          <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              aria-label="Delete video"
                              onClick={() => deleteVideo(gen)}
                              className="rounded-md bg-zinc-900/70 p-1.5 text-white hover:bg-zinc-900"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                        <div className="p-2">
                          <div className="flex items-center gap-2">
                            <Clapperboard
                              size={12}
                              className="shrink-0 text-muted-foreground"
                            />
                            <span className="truncate text-xs text-muted-foreground">
                              {modelInfo?.name ?? gen.modelId}
                            </span>
                            {gen.duration ? (
                              <span className="shrink-0 rounded border border-border/70 bg-muted/60 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                {gen.duration}s · {gen.resolution}
                                {gen.draft ? ' · draft' : ''}
                              </span>
                            ) : null}
                          </div>
                          <div className="line-clamp-2 text-xs">{gen.prompt}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <input
        ref={startInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => handleStartImage(event.target.files?.[0])}
      />
      <input
        ref={endInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => handleEndFrame(event.target.files?.[0])}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/mp4"
        className="hidden"
        onChange={(event) => handleAudio(event.target.files?.[0])}
      />
    </div>
  );
}
