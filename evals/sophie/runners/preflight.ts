import { getLanguageModel } from '@/lib/ai/providers';
import { generateText } from 'ai';

export type PreflightResult = {
  modelId: string;
  status: 'ok' | 'failed';
  resolvedIdentifier?: string;
  latencyMs: number;
  error?: string;
};

export async function runModelPreflight(
  modelIds: string[],
): Promise<PreflightResult[]> {
  const results: PreflightResult[] = [];

  for (const modelId of modelIds) {
    const start = performance.now();
    try {
      const model = getLanguageModel(modelId);
      const res = await generateText({
        model,
        prompt: 'Hello',
        maxTokens: 5,
        abortSignal: AbortSignal.timeout(10_000),
      });
      const latencyMs = Math.round(performance.now() - start);
      results.push({
        modelId,
        status: 'ok',
        resolvedIdentifier: model.modelId ?? modelId,
        latencyMs,
      });
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - start);
      results.push({
        modelId,
        status: 'failed',
        latencyMs,
        error: err?.message || String(err),
      });
    }
  }

  return results;
}
