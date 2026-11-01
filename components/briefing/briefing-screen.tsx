'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MessageCircle, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { BriefingResult, BriefingSource } from '@/lib/awareness';

const SOURCE_NAME: Record<string, string> = {
  mail: 'email',
  calendar: 'calendar',
  things: 'Things',
  memory: 'memory',
  weather: 'weather',
};

function stamp(iso: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

export function BriefingScreen({ briefing }: { briefing: BriefingResult | null }) {
  const [sources, setSources] = useState<BriefingSource[]>(briefing?.sources ?? []);
  const [remember, setRemember] = useState(briefing?.remember_from_mail ?? false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function change(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch('/api/awareness/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error('failed');
      const next = await response.json();
      setSources(next.sources);
      setRemember(next.remember_from_mail);
      setNote((next.said ?? []).join(' '));
    } catch {
      setNote('That did not go through. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!briefing) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 md:p-8">
        <h1 className="text-2xl font-semibold">Your day</h1>
        <p className="text-muted-foreground">The briefing could not be prepared just now. Try again in a moment.</p>
        <Button asChild variant="outline"><Link href="/briefing?fresh=1">Try again</Link></Button>
      </div>
    );
  }

  const { brief } = briefing;
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Your day</h1>
          <p className="text-sm text-muted-foreground">Prepared {stamp(brief.generated_at, brief.time_zone)}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/briefing?fresh=1"><RefreshCw className="mr-1 size-4" />Refresh</Link>
          </Button>
          <Button asChild size="sm">
            <Link href={`/?query=${encodeURIComponent('Talk me through my day')}`}><MessageCircle className="mr-1 size-4" />Talk me through it</Link>
          </Button>
        </div>
      </div>

      {brief.sections.length === 0 ? <p className="text-muted-foreground">Nothing needs you today.</p> : null}
      {brief.sections.map((section) => (
        <Card key={section.id}>
          <CardHeader className="pb-2"><CardTitle className="text-base">{section.title}</CardTitle></CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {section.items.map((item) => (
                <li key={`${item.source}:${item.ref}:${item.text}`} className="text-sm">
                  <span>{item.text}</span>
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{SOURCE_NAME[item.source] ?? item.source}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
      {brief.unavailable.length ? <p className="text-sm text-muted-foreground">Could not be read just now: {brief.unavailable.join(', ')}.</p> : null}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">What it uses</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {sources.map((source) => (
            <label key={source.id} className="flex items-center justify-between text-sm">
              <span>{source.label}{brief.freshness[source.id] ? <span className="ml-2 text-xs text-muted-foreground">read {stamp(brief.freshness[source.id], brief.time_zone)}</span> : null}</span>
              <input type="checkbox" checked={source.used} disabled={busy} onChange={(event) => change({ source: source.id, use: event.target.checked })} />
            </label>
          ))}
          {sources.some((s) => s.id === 'mail' && s.used) ? (
            <label className="flex items-center justify-between text-sm">
              <span>Let news in my email about my projects be remembered, marked as unconfirmed</span>
              <input type="checkbox" checked={remember} disabled={busy} onChange={(event) => change({ remember_from_mail: event.target.checked })} />
            </label>
          ) : null}
          {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
          <p className="text-xs text-muted-foreground">Turning something off stops it being used straight away. Nothing is sent or changed in any of them.</p>
        </CardContent>
      </Card>
    </div>
  );
}
