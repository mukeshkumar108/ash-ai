import { put } from '@vercel/blob';
import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import {
  calculateVideoGemCost,
  getVideoModelById,
} from '@/lib/ai/video-models';
import { readPrivateBlobDataUri, runReplicatePrediction } from '@/lib/ai/replicate';
import { saveGeneration } from '@/lib/db/queries';
import { refundGems, spendGems } from '@/lib/gems/service';

export const maxDuration = 300;
const VIDEO_POLL_TIMEOUT_MS = 240_000;

type VideoRequestBody = {
  requestId?: string;
  modelId?: string;
  prompt?: string;
  startImagePathname?: string;
  endFramePathname?: string;
  audioPathname?: string;
  duration?: number;
  resolution?: string;
  draft?: boolean;
};

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as VideoRequestBody | null;

  if (!body) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (
    typeof body.requestId !== 'string' ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId)
  ) {
    return NextResponse.json(
      { error: 'Missing generation request ID' },
      { status: 400 },
    );
  }

  const model = getVideoModelById(body.modelId ?? '');

  if (!model) {
    return NextResponse.json({ error: 'Unknown model' }, { status: 400 });
  }

  if (
    typeof body.prompt !== 'string' ||
    body.prompt.trim().length === 0 ||
    body.prompt.length > 5000
  ) {
    return NextResponse.json(
      { error: 'A prompt between 1 and 5000 characters is required' },
      { status: 400 },
    );
  }

  if (
    typeof body.startImagePathname !== 'string' ||
    body.startImagePathname.length === 0
  ) {
    return NextResponse.json(
      { error: 'A start image is required' },
      { status: 400 },
    );
  }

  const duration = Number.isInteger(body.duration)
    ? (body.duration as number)
    : model.capabilities.durations.default;
  const clampedDuration = Math.max(
    1,
    Math.min(model.capabilities.durations.max, duration),
  );

  const resolution =
    typeof body.resolution === 'string' &&
    model.capabilities.resolutions.includes(body.resolution)
      ? body.resolution
      : model.capabilities.resolutions[0];

  const draft =
    model.capabilities.draft && Boolean(body.draft);

  // Resolve the private blob inputs to data URIs (Replicate cannot fetch our
  // private blob URLs). The start image is mandatory.
  const startUri = await readPrivateBlobDataUri(body.startImagePathname);
  if (!startUri) {
    return NextResponse.json(
      { error: 'Start image could not be loaded' },
      { status: 404 },
    );
  }

  const endFrameUri =
    model.capabilities.supportsEndFrame &&
    typeof body.endFramePathname === 'string' &&
    body.endFramePathname.length > 0
      ? await readPrivateBlobDataUri(body.endFramePathname)
      : null;

  const audioUri =
    model.capabilities.supportsAudio &&
    typeof body.audioPathname === 'string' &&
    body.audioPathname.length > 0
      ? await readPrivateBlobDataUri(body.audioPathname)
      : null;

  if (endFrameUri === null && body.endFramePathname) {
    return NextResponse.json(
      { error: 'End frame image could not be loaded' },
      { status: 404 },
    );
  }
  if (audioUri === null && body.audioPathname) {
    return NextResponse.json(
      { error: 'Audio file could not be loaded' },
      { status: 404 },
    );
  }

  const input: Record<string, unknown> = {
    [model.promptField]: body.prompt.trim(),
    [model.imageField]: startUri,
    [model.durationField]: clampedDuration,
    [model.resolutionField]: resolution,
  };

  if (endFrameUri && model.endFrameField) {
    input[model.endFrameField] = endFrameUri;
  }

  if (audioUri && model.audioField) {
    input[model.audioField] = audioUri;
  }

  if (model.draftField) {
    input[model.draftField] = draft;
  }

  if (model.fixedInput) {
    Object.assign(input, model.fixedInput);
  }

  const gemCost = calculateVideoGemCost(
    model,
    clampedDuration,
    resolution,
    draft,
  );
  const spendReferenceKey = `video:${body.requestId}`;
  const spend = await spendGems({
    userId: session.user.id,
    amount: gemCost,
    kind: 'video_generation',
    referenceKey: spendReferenceKey,
    metadata: {
      modelId: model.id,
      duration: clampedDuration,
      resolution,
      draft,
    },
  });
  if (!spend.ok) {
    return NextResponse.json(
      {
        error: `You need ${gemCost} gems, but have ${spend.balance}.`,
        code: 'insufficient_gems',
        required: gemCost,
        balance: spend.balance,
      },
      { status: 402 },
    );
  }
  if (spend.duplicate) {
    return NextResponse.json(
      { error: 'This generation request was already submitted.' },
      { status: 409 },
    );
  }

  let succeeded = false;

  try {
    const outputUrls = await runReplicatePrediction(
      model.version,
      input,
      VIDEO_POLL_TIMEOUT_MS,
    );
    const results: Array<{ url: string; pathname: string; mediaType: string }> =
      [];

    for (const outputUrl of outputUrls) {
      const download = await fetch(outputUrl);

      if (!download.ok) {
        continue;
      }

      const buffer = Buffer.from(await download.arrayBuffer());
      const contentType =
        download.headers.get('content-type')?.split(';')[0] || 'video/mp4';

      const blob = await put(`video-gen/${Date.now()}.mp4`, buffer, {
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
      return NextResponse.json(
        { error: 'Failed to store generated video' },
        { status: 502 },
      );
    }

    const generationRow = await saveGeneration({
      userId: session.user.id,
      modelId: model.id,
      prompt: body.prompt.trim(),
      images: results,
      generationIndex: 1,
      parentOutputPathname: null,
      parentGenerationId: null,
    });

    succeeded = true;
    return NextResponse.json({
      modelId: model.id,
      generationId: generationRow?.[0]?.id ?? null,
      results,
      gemCost,
      gemBalance: spend.balance,
    });
  } catch (error) {
    console.error('[video-gen] failed', error);
    const message =
      error instanceof Error ? error.message : 'Failed to generate video';
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    if (!succeeded) {
      await refundGems({
        userId: session.user.id,
        amount: gemCost,
        spendReferenceKey,
        reason: 'video_generation_failed',
      });
    }
  }
}
