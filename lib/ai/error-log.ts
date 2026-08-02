type ErrorWithCause = Error & { cause?: unknown };

export function compactAIError(error: unknown): string {
  const outer = error instanceof Error ? error : null;
  const cause = outer && 'cause' in outer
    ? (outer as ErrorWithCause).cause
    : null;
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
