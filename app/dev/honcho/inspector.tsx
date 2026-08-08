'use client';

import { useCallback, useEffect, useState } from 'react';

type Chat = { id: string; title: string };
type InspectorData = {
  health: unknown;
  ids: unknown;
  queue: unknown;
  representation: string;
  conclusions: unknown[];
  messages: unknown[];
  retrievals: unknown[];
};

export function HonchoInspector({ chats }: { chats: Chat[] }) {
  const [chatId, setChatId] = useState(chats[0]?.id ?? '');
  const [data, setData] = useState<InspectorData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('What do you know about this user?');
  const [answer, setAnswer] = useState('');

  const refresh = useCallback(async () => {
    if (!chatId) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(
        `/api/dev/honcho?chatId=${encodeURIComponent(chatId)}`,
        {
          cache: 'no-store',
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Inspection failed');
      setData(body as InspectorData);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Inspection failed');
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function askMemory(event: React.FormEvent) {
    event.preventDefault();
    setAnswer('');
    const response = await fetch('/api/dev/honcho', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, query }),
    });
    const body = await response.json();
    setAnswer(
      response.ok ? (body.answer ?? '(no answer)') : `Error: ${body.error}`,
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl space-y-6 p-6 text-foreground">
      <header>
        <h1 className="text-2xl font-semibold">Honcho memory inspector</h1>
        <p className="text-sm text-muted-foreground">
          Development only. Reads Honcho; never feeds Sophie.
        </p>
      </header>
      <div className="flex gap-3">
        <select
          className="min-w-80 rounded border bg-background p-2"
          value={chatId}
          onChange={(event) => setChatId(event.target.value)}
        >
          {chats.map((chat) => (
            <option key={chat.id} value={chat.id}>
              {chat.title} — {chat.id}
            </option>
          ))}
        </select>
        <button
          className="rounded border px-4 py-2"
          type="button"
          onClick={() => void refresh()}
          disabled={loading || !chatId}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {chats.length === 0 && <p>Create a chat first, then return here.</p>}
      {error && (
        <p className="rounded border border-red-500 p-3 text-red-600">
          {error}
        </p>
      )}
      {data && (
        <>
          <section className="grid gap-3 md:grid-cols-2">
            <Panel title="Connection / health" value={data.health} />
            <Panel title="Identity mapping" value={data.ids} />
            <Panel title="Queue / derivation" value={data.queue} />
            <Panel
              title="Peer representation"
              value={data.representation}
              copy
            />
          </section>
          <Panel
            title={`Conclusions (${data.conclusions?.length ?? 0})`}
            value={data.conclusions}
          />
          <Panel
            title={`Session messages (${data.messages?.length ?? 0})`}
            value={data.messages}
          />
          <Panel
            title={`Recent targeted-memory turns (${data.retrievals?.length ?? 0})`}
            value={data.retrievals}
          />
        </>
      )}
      <form className="space-y-2 rounded border p-4" onSubmit={askMemory}>
        <label className="block font-medium" htmlFor="memory-query">
          Development peer.chat query
        </label>
        <textarea
          id="memory-query"
          className="min-h-24 w-full rounded border bg-background p-2"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={2000}
        />
        <button
          className="rounded border px-4 py-2"
          type="submit"
          disabled={!chatId || !query.trim()}
        >
          Ask Honcho
        </button>
        {answer && (
          <pre className="whitespace-pre-wrap rounded bg-muted p-3 text-sm">
            {answer}
          </pre>
        )}
      </form>
    </main>
  );
}

function Panel({
  title,
  value,
  copy = false,
}: { title: string; value: unknown; copy?: boolean }) {
  const text =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <section className="min-w-0 rounded border p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-medium">{title}</h2>
        {copy && (
          <button
            className="text-xs underline"
            type="button"
            onClick={() => void navigator.clipboard.writeText(text)}
          >
            Copy
          </button>
        )}
      </div>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
        {text}
      </pre>
    </section>
  );
}
