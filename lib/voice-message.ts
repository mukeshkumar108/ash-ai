export function voiceTranscriptParts(transcript: string) {
  return [{ type: 'text' as const, text: transcript.trim() }];
}
