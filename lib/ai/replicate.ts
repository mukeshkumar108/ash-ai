import 'server-only';

import { get } from '@vercel/blob';

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 90_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read a private Vercel blob back as a base64 data URI. Replicate cannot fetch
 * our private blob URLs directly, so inputs are resolved server-side first.
 */
export async function readPrivateBlobDataUri(
  pathname: string,
): Promise<string | null> {
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

/**
 * Create a Replicate prediction and poll it to completion. Resolves to the raw
 * output URLs on success and throws a human-readable Error otherwise.
 */
export async function runReplicatePrediction(
  version: string,
  input: Record<string, unknown>,
  timeoutMs = POLL_TIMEOUT_MS,
): Promise<string[]> {
  const created = await replicateJson(
    'https://api.replicate.com/v1/predictions',
    {
      method: 'POST',
      body: JSON.stringify({ version, input }),
    },
  );

  if (!created.ok) {
    const detail =
      (created.body as { detail?: string })?.detail || `HTTP ${created.status}`;
    throw new Error(`Replicate failed to start: ${detail}`);
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
    throw new Error('Replicate did not return a prediction');
  }

  const deadline = Date.now() + timeoutMs;

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
    throw new Error(`Generation failed${reason}`);
  }

  const outputs = Array.isArray(prediction.output)
    ? (prediction.output as string[])
    : prediction.output
      ? [prediction.output as string]
      : [];

  if (outputs.length === 0) {
    throw new Error('Replicate returned no output');
  }

  return outputs;
}

