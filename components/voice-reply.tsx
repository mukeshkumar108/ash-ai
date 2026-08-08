'use client';

import { Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from './ui/button';

export function VoiceReply({
  chatId,
  messageId,
  autoGenerate,
}: { chatId: string; messageId: string; autoGenerate: boolean }) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (loading || audioUrl) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/voice/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, messageId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Voice reply unavailable.');
      }
      setAudioUrl(URL.createObjectURL(await response.blob()));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Voice reply unavailable.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoGenerate) void generate();
  }, [autoGenerate]);
  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );

  if (audioUrl)
    return (
      <audio
        data-testid="voice-reply-audio"
        className="h-9 w-full max-w-72"
        controls
        preload="metadata"
        src={audioUrl}
      />
    );
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 rounded-full"
        onClick={generate}
        disabled={loading}
      >
        <Volume2 size={14} className="mr-1.5" />
        {loading ? 'Making voice…' : 'Listen'}
      </Button>
      {error ? (
        <span role="status">{error} Text is still available.</span>
      ) : null}
    </div>
  );
}
