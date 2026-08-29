'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowLeft, Database, Search } from 'lucide-react';

import type { ContinuityInspectorState } from '@/lib/synapse-cortex';
import type { ContinuityDeliveryDiagnostics } from '@/lib/continuity/diagnostics';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type CanonicalTask = {
  id: string;
  title: string;
  notes: string | null;
  status: string;
  source: string;
  sourceMessageId: string | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type SectionKey =
  | 'tasks'
  | 'expectations'
  | 'open_loops'
  | 'recurring_intentions'
  | 'recurring_occurrences'
  | 'attention_candidates'
  | 'commitment_candidates'
  | 'objective_progress'
  | 'initiative_opportunities'
  | 'initiative_decisions'
  | 'cortex_deliveries'
  | 'worker_heartbeats';

const sections: Array<{ key: SectionKey; label: string }> = [
  { key: 'tasks', label: 'Canonical tasks' },
  { key: 'expectations', label: 'Expectations' },
  { key: 'open_loops', label: 'Open loops' },
  { key: 'recurring_intentions', label: 'Recurring intentions' },
  { key: 'recurring_occurrences', label: 'Occurrences' },
  { key: 'attention_candidates', label: 'Attention' },
  { key: 'commitment_candidates', label: 'Task candidates' },
  { key: 'objective_progress', label: 'Progress' },
  { key: 'initiative_opportunities', label: 'Outreach queue' },
  { key: 'initiative_decisions', label: 'Outreach decisions' },
  { key: 'cortex_deliveries', label: 'Cortex delivery' },
  { key: 'worker_heartbeats', label: 'Worker health' },
];

function display(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : '—';
}

function titleFor(item: Record<string, unknown>): string {
  return display(
    item.title ??
      item.content ??
      item.topic ??
      item.candidate_key ??
      item.trigger ??
      item.status,
  );
}

function statusFor(item: Record<string, unknown>): string {
  if (item.stale === true) return 'stale';
  if (item.stuck === true) return 'stuck';
  return display(
    item.status ?? item.outcome_state ?? item.temporal_state ?? item.authority,
  );
}

function evidenceFor(item: Record<string, unknown>): string | null {
  const value =
    item.evidence_verbatim ??
    item.source_evidence ??
    item.evidence ??
    item.summary ??
    item.notes ??
    item.reason ??
    item.lastError;
  return typeof value === 'string' && value.trim() ? value : null;
}

export function ContinuityInspector({
  tasks,
  cortex,
  delivery,
}: {
  tasks: CanonicalTask[];
  cortex: ContinuityInspectorState | null;
  delivery: ContinuityDeliveryDiagnostics;
}) {
  const [section, setSection] = useState<SectionKey>('expectations');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const records =
      section === 'tasks'
        ? (tasks.map((task) => ({ ...task })) as Array<Record<string, unknown>>)
        : section === 'initiative_opportunities'
          ? delivery.initiativeOpportunities
          : section === 'initiative_decisions'
            ? delivery.initiativeDecisions
            : section === 'cortex_deliveries'
              ? delivery.cortexDeliveries
              : section === 'worker_heartbeats'
                ? delivery.workerHeartbeats
                : ((cortex?.[section] as
                    | Array<Record<string, unknown>>
                    | undefined) ?? []);
    const needle = query.trim().toLowerCase();
    if (!needle) return records;
    return records.filter((item) =>
      JSON.stringify(item).toLowerCase().includes(needle),
    );
  }, [cortex, delivery, query, section, tasks]);

  const countFor = (key: SectionKey) => {
    if (key === 'tasks') return tasks.length;
    if (key === 'initiative_opportunities')
      return delivery.initiativeOpportunities.length;
    if (key === 'initiative_decisions')
      return delivery.initiativeDecisions.length;
    if (key === 'cortex_deliveries') return delivery.cortexDeliveries.length;
    if (key === 'worker_heartbeats') return delivery.workerHeartbeats.length;
    const value = cortex?.[key];
    return Number(
      cortex?.counts?.[key] ?? (Array.isArray(value) ? value.length : 0),
    );
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl space-y-6 p-4 md:p-8">
      <header className="space-y-3">
        <Button asChild size="sm" variant="ghost">
          <Link href="/things">
            <ArrowLeft className="mr-2 size-4" />
            Back to Things
          </Link>
        </Button>
        <div className="flex items-start gap-3">
          <Database className="mt-1 size-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold">Continuity inspector</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Your own background state as Sophie currently stores it. Only
              canonical tasks are confirmed Things; every other section is
              derived, fallible evidence for testing and review.
            </p>
          </div>
        </div>
      </header>

      {!cortex ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          Cortex inspection is unavailable. Canonical tasks remain visible, but
          the background state could not be loaded.
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {sections.map((item) => (
          <button
            className={`rounded-lg border p-3 text-left transition-colors ${
              section === item.key
                ? 'border-foreground/30 bg-muted'
                : 'hover:bg-muted/60'
            }`}
            key={item.key}
            onClick={() => setSection(item.key)}
            type="button"
          >
            <span className="block text-2xl font-semibold">
              {countFor(item.key)}
            </span>
            <span className="text-xs text-muted-foreground">{item.label}</span>
          </button>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div>
            <h2 className="text-lg font-medium">
              {sections.find((item) => item.key === section)?.label}
            </h2>
            <p className="text-xs text-muted-foreground">
              {filtered.length} shown · newest records first
            </p>
          </div>
          <div className="relative w-full md:max-w-sm">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search titles, evidence, status…"
              value={query}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No records in this section.
          </p>
        ) : (
          <div className="space-y-2">
            {filtered.map((item, index) => {
              const evidence = evidenceFor(item);
              return (
                <details
                  className="rounded-lg border bg-card p-4"
                  key={display(item.id ?? item.candidate_key ?? index)}
                >
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{titleFor(item)}</p>
                        {evidence ? (
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {evidence}
                          </p>
                        ) : null}
                      </div>
                      <span className="shrink-0 rounded bg-muted px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {statusFor(item)}
                      </span>
                    </div>
                  </summary>
                  <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap break-words border-t pt-3 text-xs text-muted-foreground">
                    {JSON.stringify(item, null, 2)}
                  </pre>
                </details>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
