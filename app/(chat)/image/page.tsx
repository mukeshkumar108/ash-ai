'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, Heart, ImagePlus, Loader2, Trash2, Wand2, X } from 'lucide-react';
import { toast } from 'sonner';

import { imageModels, type ImageModel } from '@/lib/ai/image-models';
import { processImageFile } from '@/lib/image-processing';
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

const FAVS_STORAGE_KEY = 'image-studio-favs';

type FavEntry = {
  pathname: string;
  url: string;
  mediaType: string;
  prompt: string;
  modelId: string;
  likedAt: number;
};

type GeneratedImage = {
  url: string;
  pathname: string;
  mediaType: string;
};

type Generation = {
  id: string;
  modelId: string;
  prompt: string;
  status: 'loading' | 'done' | 'failed';
  error?: string;
  images: GeneratedImage[];
  createdAt: number;
  generationIndex: number;
  parentImageId?: string | null;
};

const createId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `gen-${Date.now()}`;

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });
}

function downloadNameFor(pathname: string) {
  const base = pathname.split('/').pop() ?? 'image';
  const clean = base.replace(/\.[^.]+$/, '');
  return `${clean}.${base.includes('.') ? base.split('.').pop() : 'png'}`;
}

export default function ImageStudioPage() {
  const [selectedModelId, setSelectedModelId] = useState(imageModels[0].id);
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [outputFormat, setOutputFormat] = useState('png');
  const [numOutputs, setNumOutputs] = useState(1);
  const [quality, setQuality] = useState('low');
  const [refImages, setRefImages] = useState<Array<{ id: string; dataUri: string }>>([]);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [refProcessing, setRefProcessing] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [lastOriginalPrompt, setLastOriginalPrompt] = useState<string | null>(null);
  const [favs, setFavs] = useState<Record<string, FavEntry>>({});
  const [showFavsOnly, setShowFavsOnly] = useState(false);
  const refInputRef = useRef<HTMLInputElement>(null);

  // Load favorites + generations (DB) + orphaned blobs from the store.
  useEffect(() => {
    let cancelled = false;

    let storedFavs: Record<string, FavEntry> = {};
    try {
      const raw = localStorage.getItem(FAVS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as FavEntry[];
        const map: Record<string, FavEntry> = {};
        for (const entry of parsed) map[entry.pathname] = entry;
        storedFavs = map;
      }
    } catch {
      // ignore corrupt storage
    }
    setFavs(storedFavs);

    const load = async () => {
      try {
        const response = await fetch('/api/image/list');
        if (!response.ok) return;
        const payload = await response.json();

        const fromDb: Generation[] = (payload.generations as Array<{
          id: string;
          modelId: string;
          prompt: string;
          images: GeneratedImage[];
          generationIndex: number;
          parentImageId?: string | null;
          createdAt: string;
        }>).map((row) => ({
          id: row.id,
          modelId: row.modelId,
          prompt: row.prompt,
          status: 'done' as const,
          images: row.images,
          generationIndex: row.generationIndex ?? 1,
          parentImageId: row.parentImageId ?? null,
          createdAt: new Date(row.createdAt).getTime() || 0,
        }));

        const seen = new Set<string>();
        for (const gen of fromDb) {
          for (const img of gen.images) seen.add(img.pathname);
        }

        const orphans: Generation[] = (payload.orphans as Array<{
          pathname: string;
          url: string;
          uploadedAt: string;
        }>).map((blob) => ({
          id: `recovered-${blob.pathname}`,
          modelId: storedFavs[blob.pathname]?.modelId ?? 'unknown',
          prompt:
            storedFavs[blob.pathname]?.prompt ??
            '(recovered image — original prompt not saved)',
          status: 'done' as const,
          images: [
            {
              pathname: blob.pathname,
              url: blob.url,
              mediaType: blob.pathname.toLowerCase().endsWith('.png')
                ? 'image/png'
                : 'image/jpeg',
            },
          ],
          generationIndex: 1,
          parentImageId: null,
          createdAt: new Date(blob.uploadedAt).getTime() || 0,
        }));

        if (!cancelled) {
          setGenerations(
            [...fromDb, ...orphans].sort((a, b) => b.createdAt - a.createdAt),
          );
        }
      } catch {
        // leave empty on failure
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const model =
    imageModels.find((m) => m.id === selectedModelId) ?? imageModels[0];

  const selectModel = (next: ImageModel) => {
    setSelectedModelId(next.id);
    if (!next.capabilities.aspectRatios.includes(aspectRatio)) {
      setAspectRatio(next.capabilities.aspectRatios[0] ?? '1:1');
    }
    if (!next.capabilities.outputFormats.includes(outputFormat)) {
      setOutputFormat(next.capabilities.outputFormats[0] ?? 'png');
    }
    if (next.capabilities.numOutputs) {
      setNumOutputs(next.capabilities.numOutputs.default);
    }
    if (next.capabilities.quality) {
      setQuality(next.capabilities.quality.default);
    }
    setRefImages((current) =>
      current.slice(0, Math.max(0, next.capabilities.maxRefImages)),
    );
  };

  const handleRefFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (refImages.length >= model.capabilities.maxRefImages) {
        toast.error(
          `This model accepts up to ${model.capabilities.maxRefImages} reference image${model.capabilities.maxRefImages === 1 ? '' : 's'}`,
        );
        return;
      }
      setRefProcessing(true);
      try {
        const processed = await processImageFile(file);
        const dataUri = await fileToDataUri(processed.file);
        setRefImages((current) => [
          ...current,
          { id: createId(), dataUri },
        ]);
      } catch {
        toast.error('Could not process reference image');
      } finally {
        setRefProcessing(false);
      }
    },
    [model, refImages.length],
  );

  const deleteImage = useCallback(async (img: GeneratedImage, gen: Generation) => {
    setGenerations((current) =>
      current
        .map((g) =>
          g.id === gen.id
            ? { ...g, images: g.images.filter((i) => i.pathname !== img.pathname) }
            : g,
        )
        .filter((g) => g.images.length > 0),
    );
    try {
      await fetch(`/api/files?pathname=${encodeURIComponent(img.pathname)}`, {
        method: 'DELETE',
      });
      // Remove the metadata row if this was a DB-backed generation.
      if (!gen.id.startsWith('recovered-')) {
        await fetch(`/api/image/generation/${gen.id}`, { method: 'DELETE' });
      }
    } catch {
      // best-effort cleanup
    }
  }, []);

  const downloadImage = useCallback(
    async (img: GeneratedImage) => {
      try {
        const response = await fetch(
          `/api/files?pathname=${encodeURIComponent(img.pathname)}`,
        );
        if (!response.ok) {
          throw new Error('Download failed');
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = downloadNameFor(img.pathname);
        anchor.click();
        URL.revokeObjectURL(url);
      } catch {
        toast.error('Could not download image');
      }
    },
    [],
  );

  const copyPrompt = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Prompt copied');
    } catch {
      toast.error('Could not copy prompt');
    }
  }, []);

  const enhancePrompt = useCallback(async () => {
    if (!prompt.trim()) {
      toast.error('Enter a prompt first');
      return;
    }
    setEnhancing(true);
    try {
      const response = await fetch('/api/image/enhance-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), modelId: model.id }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Enhancer failed');
      }
      setLastOriginalPrompt((current) => current ?? prompt.trim());
      setPrompt(payload.enhancedPrompt);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Enhancer failed');
    } finally {
      setEnhancing(false);
    }
  }, [prompt, model]);

  const revertPrompt = useCallback(() => {
    if (lastOriginalPrompt != null) {
      setPrompt(lastOriginalPrompt);
      setLastOriginalPrompt(null);
    }
  }, [lastOriginalPrompt]);

  const toggleFav = useCallback(
    (img: GeneratedImage, gen: Generation) => {
      setFavs((current) => {
        const next = { ...current };
        if (next[img.pathname]) {
          delete next[img.pathname];
        } else {
          next[img.pathname] = {
            pathname: img.pathname,
            url: img.url,
            mediaType: img.mediaType,
            prompt: gen.prompt,
            modelId: gen.modelId,
            likedAt: Date.now(),
          };
        }
        const entries = Object.values(next).sort(
          (a, b) => b.likedAt - a.likedAt,
        );
        try {
          localStorage.setItem(FAVS_STORAGE_KEY, JSON.stringify(entries));
        } catch {
          // storage unavailable
        }
        return next;
      });
    },
    [],
  );

  const generate = useCallback(async () => {
    if (!prompt.trim()) {
      toast.error('Enter a prompt first');
      return;
    }

    const id = createId();
    const gen: Generation = {
      id,
      modelId: model.id,
      prompt: prompt.trim(),
      status: 'loading',
      images: [],
      createdAt: Date.now(),
      generationIndex: 1,
      parentImageId: null,
    };

    setGenerations((current) => [gen, ...current]);

    try {
      const response = await fetch('/api/image/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: model.id,
          prompt: prompt.trim(),
          aspectRatio,
          outputFormat,
          numOutputs,
          quality,
          refImages: refImages.map((ref) => ref.dataUri),
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Generation failed');
      }

      setGenerations((current) =>
        current.map((g) =>
          g.id === id
            ? { ...g, status: 'done', images: payload.results }
            : g,
        ),
      );
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
    }
  }, [prompt, model, aspectRatio, outputFormat, numOutputs, quality, refImages]);

  const isGenerating = generations.some((gen) => gen.status === 'loading');

  // Flat, newest-first list of completed images for the masonry grid.
  const images = useMemo(() => {
    const flat: Array<{ gen: Generation; img: GeneratedImage }> = [];
    for (const gen of generations) {
      if (gen.status === 'done') {
        for (const img of gen.images) flat.push({ gen, img });
      }
    }
    return flat;
  }, [generations]);

  return (
    <div className="flex min-h-dvh w-full flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Image Studio</h1>
        <p className="text-sm text-muted-foreground">
          Generate images with Replicate models. The form adapts to the
          capabilities of the selected model.
        </p>
      </div>

      <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
        {/* Controls column */}
        <div className="flex w-full shrink-0 flex-col gap-4 md:sticky md:top-6 md:w-80">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Model
            </span>
            <Select
              value={selectedModelId}
              onValueChange={(value) => {
                const next = imageModels.find((m) => m.id === value);
                if (next) selectModel(next);
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {imageModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    <span className="flex items-center gap-2">
                      {m.name}
                      <span className="text-[10px] text-muted-foreground">
                        {m.capabilities.imageToImage ? 'img→img' : 'text→img'}
                        {m.capabilities.maxRefImages > 1
                          ? ` · ${m.capabilities.maxRefImages} refs`
                          : ''}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {model.description}
            </p>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4">
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe the image you want to generate…"
              className="min-h-24 bg-background"
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={enhancePrompt}
                disabled={enhancing || !prompt.trim() || isGenerating}
                title="Rewrite the prompt for the selected model"
              >
                {enhancing ? (
                  <Loader2 size={14} className="mr-1 animate-spin" />
                ) : (
                  <Wand2 size={14} className="mr-1" />
                )}
                Rewrite
              </Button>
              {lastOriginalPrompt != null && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={revertPrompt}
                  title="Revert to the original prompt"
                >
                  Revert
                </Button>
              )}
              <span className="text-[10px] text-muted-foreground">
                Rewrites via a model-aware prompt enhancer for {model.name}
              </span>
            </div>

            {model.capabilities.aspectRatios.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-xs text-muted-foreground">
                  Ratio
                </span>
                <Select value={aspectRatio} onValueChange={setAspectRatio}>
                  <SelectTrigger className="h-8 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {model.capabilities.aspectRatios.map((ratio) => (
                      <SelectItem key={ratio} value={ratio}>
                        {ratio}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {model.capabilities.outputFormats.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-xs text-muted-foreground">
                  Format
                </span>
                <Select value={outputFormat} onValueChange={setOutputFormat}>
                  <SelectTrigger className="h-8 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {model.capabilities.outputFormats.map((format) => (
                      <SelectItem key={format} value={format}>
                        {format}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {model.capabilities.numOutputs && (
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-xs text-muted-foreground">
                  Images
                </span>
                <Select
                  value={String(numOutputs)}
                  onValueChange={(value) => setNumOutputs(Number(value))}
                >
                  <SelectTrigger className="h-8 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from(
                      { length: model.capabilities.numOutputs.max },
                      (_, index) => index + 1,
                    ).map((count) => (
                      <SelectItem key={count} value={String(count)}>
                        {count}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {model.capabilities.quality && (
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-xs text-muted-foreground">
                  Quality
                </span>
                <Select value={quality} onValueChange={setQuality}>
                  <SelectTrigger className="h-8 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {model.capabilities.quality.options.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {model.capabilities.imageToImage &&
              model.capabilities.maxRefImages > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-xs text-muted-foreground">
                    Reference images ({refImages.length}/{model.capabilities.maxRefImages})
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {refImages.map((ref) => (
                      <div key={ref.id} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={ref.dataUri}
                          alt="Reference"
                          className="h-16 w-16 rounded-lg border object-cover"
                        />
                        <button
                          type="button"
                          aria-label="Remove reference image"
                          onClick={() =>
                            setRefImages((current) =>
                              current.filter((item) => item.id !== ref.id),
                            )
                          }
                          className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-zinc-900/80 text-white"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                    {refImages.length < model.capabilities.maxRefImages && (
                      <button
                        type="button"
                        aria-label="Add reference image"
                        onClick={() => refInputRef.current?.click()}
                        disabled={refProcessing}
                        className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed text-muted-foreground hover:bg-muted/50"
                      >
                        {refProcessing ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <ImagePlus size={16} />
                        )}
                      </button>
                    )}
                  </div>
                  <input
                    ref={refInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => handleRefFile(event.target.files?.[0])}
                  />
                </div>
              )}

            <Button
              type="button"
              onClick={generate}
              disabled={isGenerating || !prompt.trim()}
            >
              {isGenerating ? (
                <>
                  <Loader2 size={14} className="mr-1 animate-spin" />
                  Generating…
                </>
              ) : (
                'Generate'
              )}
            </Button>
          </div>
        </div>

        {/* Results column */}
        <div className="min-w-0 flex-1">
          {generations.length === 0 ? (
            <div className="flex h-48 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
              Generated images will appear here
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {images.length} image{images.length === 1 ? '' : 's'}
                </span>
                {Object.keys(favs).length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowFavsOnly((current) => !current)}
                    className={cn(
                      'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
                      showFavsOnly
                        ? 'border-pink-500/50 bg-pink-500/10 text-pink-600'
                        : 'border-border text-muted-foreground hover:bg-muted/40',
                    )}
                  >
                    <Heart
                      size={12}
                      className={showFavsOnly ? 'fill-current' : ''}
                    />
                    Favorites ({Object.keys(favs).length})
                  </button>
                )}
              </div>

              {generations.some((gen) => gen.status !== 'done') && (
                <div className="mb-4 flex flex-col gap-2">
                  {generations
                    .filter((gen) => gen.status !== 'done')
                    .map((gen) => (
                      <div
                        key={gen.id}
                        className={cn(
                          'rounded-xl border p-3 text-sm',
                          gen.status === 'failed'
                            ? 'border-red-500/30 bg-red-500/10 text-red-600'
                            : 'border-border bg-muted/30 text-muted-foreground',
                        )}
                      >
                        {gen.status === 'loading' ? (
                          <span className="flex items-center gap-2">
                            <Loader2 size={14} className="animate-spin" />
                            Generating “{gen.prompt}”…
                          </span>
                        ) : (
                          gen.error ?? 'Generation failed'
                        )}
                      </div>
                    ))}
                </div>
              )}

              <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
                {images
                  .filter(({ img }) => !showFavsOnly || favs[img.pathname])
                  .map(({ gen, img }) => (
                  <div
                    key={img.pathname}
                    className="group mb-4 break-inside-avoid overflow-hidden rounded-xl border"
                  >
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={getBlobDisplayUrl(img.url)}
                        alt={gen.prompt}
                        className="w-full object-cover"
                      />
                      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          aria-label={favs[img.pathname] ? 'Unfavorite' : 'Favorite'}
                          onClick={() => toggleFav(img, gen)}
                          className={cn(
                            'rounded-md bg-zinc-900/70 p-1.5 text-white hover:bg-zinc-900',
                            favs[img.pathname] && 'text-pink-400',
                          )}
                        >
                          <Heart
                            size={13}
                            className={favs[img.pathname] ? 'fill-current' : ''}
                          />
                        </button>
                        <button
                          type="button"
                          aria-label="Copy prompt"
                          onClick={() => copyPrompt(gen.prompt)}
                          className="rounded-md bg-zinc-900/70 p-1.5 text-white hover:bg-zinc-900"
                        >
                          <Copy size={13} />
                        </button>
                        <button
                          type="button"
                          aria-label="Download image"
                          onClick={() => downloadImage(img)}
                          className="rounded-md bg-zinc-900/70 p-1.5 text-white hover:bg-zinc-900"
                        >
                          <Download size={13} />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete image"
                          onClick={() => deleteImage(img, gen)}
                          className="rounded-md bg-zinc-900/70 p-1.5 text-white hover:bg-zinc-900"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    <div className="p-2">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs text-muted-foreground">
                          {imageModels.find((m) => m.id === gen.modelId)?.name ??
                            gen.modelId}
                        </span>
                        <span
                          title={
                            gen.generationIndex === 1
                              ? 'Original generation'
                              : `Remix of a generation ${gen.generationIndex - 1} image`
                          }
                          className="shrink-0 rounded border border-border/70 bg-muted/60 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                        >
                          Gen {gen.generationIndex}
                        </span>
                      </div>
                      <div className="line-clamp-2 text-xs">{gen.prompt}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
