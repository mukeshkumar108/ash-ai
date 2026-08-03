'use client';

import { useCallback, useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import { imageModels, type ImageModel } from '@/lib/ai/image-models';
import { processImageFile } from '@/lib/image-processing';
import { getBlobDisplayUrl } from '@/lib/blob';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

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

export default function ImageStudioPage() {
  const [selectedModelId, setSelectedModelId] = useState(imageModels[0].id);
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [outputFormat, setOutputFormat] = useState('png');
  const [refImage, setRefImage] = useState<string | null>(null);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [refProcessing, setRefProcessing] = useState(false);
  const refInputRef = useRef<HTMLInputElement>(null);

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
    if (next.capabilities.maxRefImages === 0) {
      setRefImage(null);
    }
  };

  const handleRefFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setRefProcessing(true);
      try {
        const processed = await processImageFile(file);
        const dataUri = await fileToDataUri(processed.file);
        setRefImage(dataUri);
      } catch {
        toast.error('Could not process reference image');
      } finally {
        setRefProcessing(false);
      }
    },
    [],
  );

  const removeImage = useCallback(async (pathname: string) => {
    setGenerations((current) =>
      current.map((gen) => ({
        ...gen,
        images: gen.images.filter((img) => img.pathname !== pathname),
      })),
    );
    try {
      await fetch(`/api/files?pathname=${encodeURIComponent(pathname)}`, {
        method: 'DELETE',
      });
    } catch {
      // best-effort cleanup
    }
  }, []);

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
          refImage,
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
  }, [prompt, model, aspectRatio, outputFormat, refImage]);

  const isGenerating = generations.some((gen) => gen.status === 'loading');

  return (
    <div className="flex flex-col min-h-dvh gap-6 p-4 md:p-6 max-w-4xl mx-auto w-full">
      <div>
        <h1 className="text-2xl font-semibold">Image Studio</h1>
        <p className="text-sm text-muted-foreground">
          Generate images with Replicate models. Different models accept
          different inputs — the form adapts to the selected model.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Model
        </span>
        <div className="grid gap-2 sm:grid-cols-2">
          {imageModels.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => selectModel(m)}
              className={cn(
                'rounded-xl border p-3 text-left transition-colors',
                m.id === selectedModelId
                  ? 'border-primary bg-muted/60'
                  : 'border-border hover:bg-muted/40',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">{m.name}</span>
                <span className="text-[10px] text-muted-foreground">
                  {m.capabilities.textToImage ? 'text→image' : ''}
                  {m.capabilities.imageToImage ? ' · image→image' : ''}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {m.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4">
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Describe the image you want to generate…"
          className="min-h-24 bg-background"
        />

        {model.capabilities.aspectRatios.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground mr-1">Ratio</span>
            {model.capabilities.aspectRatios.map((ratio) => (
              <button
                key={ratio}
                type="button"
                onClick={() => setAspectRatio(ratio)}
                className={cn(
                  'rounded-md border px-2 py-1 text-xs transition-colors',
                  ratio === aspectRatio
                    ? 'border-primary bg-muted'
                    : 'border-border hover:bg-muted/50',
                )}
              >
                {ratio}
              </button>
            ))}
          </div>
        )}

        {model.capabilities.outputFormats.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground mr-1">Format</span>
            {model.capabilities.outputFormats.map((format) => (
              <button
                key={format}
                type="button"
                onClick={() => setOutputFormat(format)}
                className={cn(
                  'rounded-md border px-2 py-1 text-xs transition-colors',
                  format === outputFormat
                    ? 'border-primary bg-muted'
                    : 'border-border hover:bg-muted/50',
                )}
              >
                {format}
              </button>
            ))}
          </div>
        )}

        {model.capabilities.imageToImage && model.capabilities.maxRefImages > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-muted-foreground">
              Reference image ({model.capabilities.maxRefImages})
            </span>
            {refImage ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={refImage}
                  alt="Reference"
                  className="h-16 w-16 rounded-lg border object-cover"
                />
                <button
                  type="button"
                  aria-label="Remove reference image"
                  onClick={() => setRefImage(null)}
                  className="absolute -top-1.5 -right-1.5 rounded-full bg-zinc-900/80 p-0.5 text-white"
                >
                  <X size={11} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => refInputRef.current?.click()}
                className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50"
              >
                <ImagePlus size={14} />
                {refProcessing ? 'Processing…' : 'Upload reference image'}
              </button>
            )}
            <input
              ref={refInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => handleRefFile(event.target.files?.[0])}
            />
          </div>
        )}

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={generate}
            disabled={isGenerating || !prompt.trim()}
          >
            {isGenerating ? (
              <>
                <Loader2 size={14} className="animate-spin mr-1" />
                Generating…
              </>
            ) : (
              'Generate'
            )}
          </Button>
        </div>
      </div>

      {generations.length > 0 && (
        <div className="flex flex-col gap-6">
          {generations.map((gen) => (
            <div key={gen.id} className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-muted-foreground">
                  {imageModels.find((m) => m.id === gen.modelId)?.name ??
                    gen.modelId}
                </span>
                <span className="text-xs text-muted-foreground line-clamp-2">
                  {gen.prompt}
                </span>
              </div>

              {gen.status === 'loading' && (
                <div className="flex h-48 items-center justify-center rounded-xl border bg-muted/30 text-sm text-muted-foreground">
                  <Loader2 size={16} className="animate-spin mr-2" />
                  Generating…
                </div>
              )}

              {gen.status === 'failed' && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">
                  {gen.error ?? 'Generation failed'}
                </div>
              )}

              {gen.status === 'done' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {gen.images.map((img) => (
                    <div
                      key={img.pathname}
                      className="group relative overflow-hidden rounded-xl border"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={getBlobDisplayUrl(img.url)}
                        alt={gen.prompt}
                        className="w-full object-cover"
                      />
                      <button
                        type="button"
                        aria-label="Delete image"
                        onClick={() => removeImage(img.pathname)}
                        className="absolute right-2 top-2 rounded-full bg-zinc-900/70 p-1.5 text-white opacity-0 transition-opacity hover:bg-zinc-900 group-hover:opacity-100"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
