export type VoiceRuntimeServerEvent = {
  type?: string;
  delta?: string;
  transcript?: string;
  phase?: string;
  classification?: 'INTERRUPT' | 'CONTINUE' | 'UNCERTAIN';
  classification_latency_ms?: number;
  decision?: 'cancel' | 'continue';
  reason?: string;
  response?: { status?: string };
  error?: { message?: string; type?: string };
};

export function fatalVoiceRuntimeError(
  event: VoiceRuntimeServerEvent,
): string | null {
  if (event.type !== 'error') return null;

  switch (event.error?.type) {
    case 'transcription_failed':
      return 'Speech recognition unavailable';
    case 'session_limit_reached':
      return 'Voice server is busy';
    case 'invalid_session_type':
      return 'Voice server rejected call setup';
    default:
      return null;
  }
}
