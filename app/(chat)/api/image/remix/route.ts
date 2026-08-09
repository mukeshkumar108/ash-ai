import { get, put } from '@vercel/blob';
import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import { getImageModelById } from '@/lib/ai/image-models';
import {
  compileRemix,
  buildProviderInput,
  emptyRemixState,
  referencesAncestor,
} from '@/lib/ai/remix';
import type {
  LineageHop,
  RemixContext,
  RemixRef,
  ResolvedRemixInput,
} from '@/lib/ai/remix';
import { runReplicatePrediction } from '@/lib/ai/replicate';
import { getGenerationById, saveGeneration } from '@/lib/db/queries';
import type { Generation, RemixInputImage, RemixState } from '@/lib/db/schema';
import { calculateGemCost } from '@/lib/gems/catalog';
import { refundGems, spendGems } from '@/lib/gems/service';

export const maxDuration = 300;

const MAX_PROMPT_LENGTH = 5000;
const MAX_ANCESTOR_HOPS = 6;
const ALLOWED_ROLES: RemixInputImage['role'][] = [
  'baseline',
  'style',
  'object',
  'identity',
  'layout',
];

type RemixRequestBody = {
  requestId?: string;
  modelId?: string;
  parentGenerationId?: string;
  parentOutputPathname?: string;
  instruction?: string;
  refs?: Array<{
    pathname?: string;
    mediaType?: string;
    role?: string;
    description?: string;
  }>;
  aspectRatio?: string;
  outputFormat?: string;
  numOutputs?: number;
  quality?: string;
};

async function blobDataUriFor(pathname: string): Promise<string | null> {
  try {
    const result = await get(pathname, {
      access: 'private',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    if (result?.statusCode !== 200 || !result.stream) return null;
    const chunks: Uint8Array[] = [];
    const reader = result.stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const bytes = new Uint8Array(
      chunks.reduce((total, chunk) => total + chunk.length, 0),
    );
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const mediaType = result.blob.contentType || 'image/png';
    return `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`;
  } catch {
    return null;
  }
}

function isBaselineOf(parent: Generation, pathname: string): boolean {
  const images = (parent.images ?? []) as Array<{
    url: string;
    pathname: string;
    mediaType: string;
  }>;
  return images.some((img) => img.pathname === pathname);
}

function mediaTypeOf(parent: Generation, pathname: string): string {
  const images = (parent.images ?? []) as Array<{
    url: string;
    pathname: string;
    mediaType: string;
  }>;
  return (
    images.find((img) => img.pathname === pathname)?.mediaType ?? 'image/png'
  );
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request
    .json()
    .catch(() => null)) as RemixRequestBody | null;

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

  const { modelId, parentGenerationId, parentOutputPathname, instruction } =
    body;

  if (typeof modelId !== 'string' || !modelId) {
    return NextResponse.json({ error: 'Missing model' }, { status: 400 });
  }
  if (
    typeof instruction !== 'string' ||
    instruction.trim().length === 0 ||
    instruction.length > MAX_PROMPT_LENGTH
  ) {
    return NextResponse.json(
      { error: 'An instruction between 1 and 5000 characters is required' },
      { status: 400 },
    );
  }
  if (
    typeof parentGenerationId !== 'string' ||
    typeof parentOutputPathname !== 'string' ||
    parentGenerationId.length === 0 ||
    parentOutputPathname.length === 0
  ) {
    return NextResponse.json(
      { error: 'Missing baseline image provenance' },
      { status: 400 },
    );
  }

  const model = getImageModelById(modelId);

  if (!model || !model.capabilities.imageToImage || !model.imageField) {
    return NextResponse.json(
      { error: 'This model cannot edit images' },
      { status: 400 },
    );
  }

  const parent = await getGenerationById({
    id: parentGenerationId,
    userId: session.user.id,
  });

  if (!parent || !isBaselineOf(parent, parentOutputPathname)) {
    return NextResponse.json(
      { error: 'Baseline image not found' },
      { status: 404 },
    );
  }

  const refs: RemixRef[] = (body.refs ?? [])
    .filter(
      (ref) => typeof ref.pathname === 'string' && ref.pathname.length > 0,
    )
    .map((ref) => ({
      pathname: ref.pathname as string,
      mediaType:
        typeof ref.mediaType === 'string' && ref.mediaType.length > 0
          ? ref.mediaType
          : 'image/png',
      role: ALLOWED_ROLES.includes(ref.role as RemixInputImage['role'])
        ? (ref.role as RemixInputImage['role'])
        : 'style',
      ...(typeof ref.description === 'string' && ref.description.length > 0
        ? { description: ref.description }
        : {}),
    }));

  const parentState =
    (parent.remixState as RemixState | null) ?? emptyRemixState(parent.prompt);

  // Only load ancestor history when the instruction actually references it.
  const lineage: LineageHop[] = [];
  if (referencesAncestor(instruction)) {
    let hop: Generation | null = parent;
    while (hop && lineage.length < MAX_ANCESTOR_HOPS) {
      lineage.push({
        generationIndex: hop.generationIndex,
        modelId: hop.modelId,
        prompt: hop.prompt,
        instruction: hop.instruction,
        remixState: (hop.remixState as RemixState | null) ?? null,
      });
      if (!hop.parentGenerationId) break;
      hop = await getGenerationById({
        id: hop.parentGenerationId,
        userId: session.user.id,
      });
    }
    lineage.reverse();
  }

  const baseline: RemixRef = {
    pathname: parentOutputPathname,
    mediaType: mediaTypeOf(parent, parentOutputPathname),
    role: 'baseline',
    description: parent.prompt,
  };

  const ctx: RemixContext = {
    baseline,
    refs,
    instruction: instruction.trim(),
    parentState,
    lineage,
    model,
  };

  let plan: Awaited<ReturnType<typeof compileRemix>>;
  try {
    plan = await compileRemix(ctx);
  } catch (error) {
    console.error('[remix] compile failed', error);
    return NextResponse.json(
      { error: 'Failed to build remix plan' },
      { status: 500 },
    );
  }

  // Resolve stable data URIs for every input (Replicate cannot fetch our
  // private blob URLs). Baseline must resolve or the request is invalid.
  const resolved: ResolvedRemixInput[] = [];
  for (const ref of plan.inputs) {
    const dataUri = await blobDataUriFor(ref.pathname);
    if (!dataUri) {
      return NextResponse.json(
        {
          error:
            ref.role === 'baseline'
              ? 'Baseline image could not be loaded'
              : `Reference image could not be loaded: ${ref.pathname}`,
        },
        { status: 404 },
      );
    }
    resolved.push({ ...ref, dataUri });
  }

  const input = buildProviderInput(model, plan.prompt, resolved);

  if (
    model.aspectRatioField &&
    typeof body.aspectRatio === 'string' &&
    model.capabilities.aspectRatios.includes(body.aspectRatio)
  ) {
    input[model.aspectRatioField] = body.aspectRatio;
  }

  if (
    model.outputFormatField &&
    typeof body.outputFormat === 'string' &&
    model.capabilities.outputFormats.includes(body.outputFormat)
  ) {
    input[model.outputFormatField] = body.outputFormat;
  }

  if (model.numOutputsField && model.capabilities.numOutputs) {
    const count = Number.isInteger(body.numOutputs)
      ? (body.numOutputs as number)
      : model.capabilities.numOutputs.default;
    input[model.numOutputsField] = Math.max(
      1,
      Math.min(model.capabilities.numOutputs.max, count),
    );
  }

  if (model.qualityField && model.capabilities.quality) {
    const selected =
      typeof body.quality === 'string' &&
      model.capabilities.quality.options.includes(body.quality)
        ? body.quality
        : model.capabilities.quality.default;
    input[model.qualityField] = selected;
  }

  if (model.fixedInput) {
    Object.assign(input, model.fixedInput);
  }

  const outputCount = model.capabilities.numOutputs
    ? Math.max(
        1,
        Math.min(
          model.capabilities.numOutputs.max,
          Number.isInteger(body.numOutputs)
            ? (body.numOutputs as number)
            : model.capabilities.numOutputs.default,
        ),
      )
    : 1;
  const gemCost = calculateGemCost(model.gemCost, outputCount);
  const spendReferenceKey = `image:${body.requestId}`;
  const spend = await spendGems({
    userId: session.user.id,
    amount: gemCost,
    kind: 'image_remix',
    referenceKey: spendReferenceKey,
    metadata: { modelId: model.id, outputCount, parentGenerationId },
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
    const outputUrls = await runReplicatePrediction(model.version, input);
    const results: Array<{ url: string; pathname: string; mediaType: string }> =
      [];
    for (const outputUrl of outputUrls) {
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
      return NextResponse.json(
        { error: 'Failed to store generated image' },
        { status: 502 },
      );
    }

    const generationRow = await saveGeneration({
      userId: session.user.id,
      modelId: model.id,
      prompt: plan.prompt,
      images: results,
      generationIndex: (parent.generationIndex ?? 1) + 1,
      parentGenerationId: parent.id,
      parentOutputPathname,
      instruction: instruction.trim(),
      inputImages: plan.inputs.map(({ pathname, mediaType, role }) => ({
        pathname,
        mediaType,
        role,
      })),
      remixState: plan.nextState,
    });

    succeeded = true;
    return NextResponse.json({
      modelId: model.id,
      generationId: generationRow?.[0]?.id ?? null,
      prompt: plan.prompt,
      compiled: plan.compiled,
      warnings: plan.warnings,
      results,
      gemCost,
      gemBalance: spend.balance,
    });
  } catch (error) {
    console.error('[image-remix] failed', error);
    const message =
      error instanceof Error ? error.message : 'Failed to generate image';
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    if (!succeeded) {
      await refundGems({
        userId: session.user.id,
        amount: gemCost,
        spendReferenceKey,
        reason: 'image_remix_failed',
      });
    }
  }
}
