import { put } from '@vercel/blob';
import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import { getImageModelById } from '@/lib/ai/image-models';

export const maxDuration = 300;
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 90_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function replicateJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env.REPL_API_KEY}`,
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);

  if (!body) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { modelId, prompt, aspectRatio, outputFormat, refImage } = body as {
    modelId?: string;
    prompt?: string;
    aspectRatio?: string;
    outputFormat?: string;
    refImage?: string;
  };

  const model = getImageModelById(modelId ?? '');

  if (!model) {
    return NextResponse.json({ error: 'Unknown model' }, { status: 400 });
  }

  if (typeof prompt !== 'string' || prompt.trim().length === 0 || prompt.length > 5000) {
    return NextResponse.json(
      { error: 'A prompt between 1 and 5000 characters is required' },
      { status: 400 },
    );
  }

  if (
    model.capabilities.imageToImage &&
    !model.imageField &&
    typeof refImage === 'string'
  ) {
    return NextResponse.json(
      { error: 'This model does not accept a reference image' },
      { status: 400 },
    );
  }

  const input: Record<string, unknown> = {
    [model.promptField]: prompt.trim(),
  };

  if (model.imageField && typeof refImage === 'string' && refImage.length > 0) {
    input[model.imageField] = refImage;
  }

  if (
    model.aspectRatioField &&
    typeof aspectRatio === 'string' &&
    model.capabilities.aspectRatios.includes(aspectRatio)
  ) {
    input[model.aspectRatioField] = aspectRatio;
  }

  if (
    model.outputFormatField &&
    typeof outputFormat === 'string' &&
    model.capabilities.outputFormats.includes(outputFormat)
  ) {
    input[model.outputFormatField] = outputFormat;
  }

  try {
    const created = await replicateJson('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      body: JSON.stringify({ version: model.version, input }),
    });

    if (!created.ok) {
      const detail =
        (created.body as { detail?: string })?.detail || `HTTP ${created.status}`;
      return NextResponse.json(
        { error: `Replicate failed to start: ${detail}` },
        { status: 502 },
      );
    }

    let prediction = created.body as {
      id: string;
      status: string;
      urls?: { get?: string };
      error?: unknown;
      output?: unknown;
    };
    const getUrl = prediction.urls?.get;

    if (!getUrl) {
      return NextResponse.json({ error: 'Replicate did not return a prediction' }, { status: 502 });
    }

    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (
      !['succeeded', 'failed', 'canceled'].includes(prediction.status) &&
      Date.now() < deadline
    ) {
      await sleep(POLL_INTERVAL_MS);
      const polled = await replicateJson(getUrl);
      if (polled.ok) {
        prediction = polled.body as typeof prediction;
      }
    }

    if (prediction.status !== 'succeeded') {
      const reason =
        prediction.error != null
          ? `: ${JSON.stringify(prediction.error).slice(0, 200)}`
          : ` (${prediction.status})`;
      return NextResponse.json(
        { error: `Generation failed${reason}` },
        { status: 502 },
      );
    }

    const outputs = Array.isArray(prediction.output)
      ? (prediction.output as string[])
      : prediction.output
        ? [prediction.output as string]
        : [];

    if (outputs.length === 0) {
      return NextResponse.json({ error: 'Replicate returned no output' }, { status: 502 });
    }

    const results = [];

    for (const outputUrl of outputs) {
      const download = await fetch(outputUrl);

      if (!download.ok) {
        continue;
      }

      const buffer = Buffer.from(await download.arrayBuffer());
      const contentType =
        download.headers.get('content-type')?.split(';')[0] || 'image/png';

      const blob = await put(`image-gen/${Date.now()}.img`, buffer, {
        access: 'private',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: true,
        contentType,
      });

      results.push({
        url: blob.url,
        pathname: blob.pathname,
        mediaType: blob.contentType,
      });
    }

    if (results.length === 0) {
      return NextResponse.json({ error: 'Failed to store generated image' }, { status: 502 });
    }

    return NextResponse.json({ modelId: model.id, results });
  } catch (error) {
    console.error('[image-gen] failed', error);
    return NextResponse.json({ error: 'Failed to generate image' }, { status: 500 });
  }
}
