import 'server-only';

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

/**
 * Create a Replicate prediction and poll it to completion. Resolves to the raw
 * output URLs on success and throws a human-readable Error otherwise.
 */
export async function runReplicatePrediction(
  version: string,
  input: Record<string, unknown>,
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
