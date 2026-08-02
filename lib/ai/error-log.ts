type ErrorWithCause = Error & { cause?: unknown };

function extractAPICallErrorDetails(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as {
    name?: string;
    statusCode?: number;
    responseBody?: string;
  };
  if (
    candidate.name === 'APICallError' ||
    (candidate.statusCode != null && candidate.responseBody != null)
  ) {
    const body = (candidate.responseBody || '').trim();
    const snippet = body.length > 240 ? `${body.slice(0, 237)}...` : body;
    return `${candidate.name}${candidate.statusCode != null ? ` (${candidate.statusCode})` : ''}${snippet ? `: ${snippet}` : ''}`;
  }
  return null;
}

export function compactAIError(error: unknown): string {
  const outer = error instanceof Error ? error : null;
  const cause = outer && 'cause' in outer
    ? (outer as ErrorWithCause).cause
    : null;

  const apiDetails = extractAPICallErrorDetails(error) ?? extractAPICallErrorDetails(cause);
  if (apiDetails) return apiDetails;

  const source = cause instanceof Error
    ? `${cause.name}: ${cause.message}`
    : outer
      ? `${outer.name}: ${outer.message}`
      : String(error);

  return source.replace(/\s+/g, ' ').trim().slice(0, 280);
}

export function logAIError(area: string, error: unknown): void {
  console.error(`[ai:${area}] ${compactAIError(error)}`);
}
