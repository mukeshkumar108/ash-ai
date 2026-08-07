'use client';

import {
  ExternalLink,
  FileSearch,
  ImageIcon,
  MapPin,
  Newspaper,
  Search,
  Video,
} from 'lucide-react';
import type { ResearchActivity, ResearchTrace } from '@/lib/types';
import { summarizeResearchTrace } from '@/lib/research-trace';

function ActivityIcon({ kind }: { kind: ResearchActivity['kind'] }) {
  const className = 'size-3.5 shrink-0';
  if (kind === 'news') return <Newspaper className={className} />;
  if (kind === 'video') return <Video className={className} />;
  if (kind === 'image') return <ImageIcon className={className} />;
  if (kind === 'place') return <MapPin className={className} />;
  if (kind === 'page') return <FileSearch className={className} />;
  return <Search className={className} />;
}

function activityLabel(activity: ResearchActivity): string {
  if (activity.kind === 'page') {
    try {
      const action =
        activity.status === 'failed' ? "Couldn't read page" : 'Read page';
      return `${action} · ${new URL(activity.query).hostname.replace(/^www\./u, '')}`;
    } catch {
      return 'Read public page';
    }
  }
  if (activity.kind === 'news') return 'Searched recent news';
  if (activity.kind === 'video') return 'Looked for videos';
  if (activity.kind === 'image') return 'Looked for images';
  if (activity.kind === 'place') return 'Looked up places';
  return 'Researched the web';
}

export function ResearchTraceView({ trace }: { trace: ResearchTrace }) {
  if (trace.activities.length === 0) return null;
  const orderedSources = [...trace.sources].sort(
    (left, right) => Number(Boolean(right.cited)) - Number(Boolean(left.cited)),
  );
  const visibleSources = orderedSources.slice(0, 12);

  return (
    <details
      className="group rounded-lg border border-border/70 bg-muted/30 text-sm"
      data-testid="research-trace"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-muted-foreground marker:hidden">
        <FileSearch className="size-4" />
        <span>{summarizeResearchTrace(trace)}</span>
        <span className="ml-auto text-xs group-open:hidden">Show</span>
        <span className="ml-auto hidden text-xs group-open:inline">Hide</span>
      </summary>

      <div className="space-y-3 border-t border-border/70 px-3 py-3">
        <ul className="space-y-2">
          {trace.activities.map((activity, index) => (
            <li
              className="flex items-start gap-2 text-muted-foreground"
              key={`${activity.kind}-${activity.query}-${index}`}
            >
              <ActivityIcon kind={activity.kind} />
              <span>
                {activityLabel(activity)}
                {activity.kind !== 'page' ? ` for “${activity.query}”` : ''}
                {activity.kind !== 'page' && activity.resultCount !== undefined
                  ? ` (${activity.resultCount} results)`
                  : ''}
                {activity.status === 'failed' && activity.kind !== 'page'
                  ? ' (failed)'
                  : ''}
              </span>
            </li>
          ))}
        </ul>

        {visibleSources.length > 0 && (
          <ul className="space-y-1.5 border-t border-border/70 pt-3">
            {visibleSources.map((source) => (
              <li key={source.url}>
                <a
                  className="flex items-start gap-2 text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                  href={source.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {source.title}{' '}
                    {source.cited && (
                      <span className="text-xs text-muted-foreground">
                        cited ·{' '}
                      </span>
                    )}
                    {source.retrieval === 'page_read' && (
                      <span className="text-xs text-muted-foreground">
                        page read ·{' '}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {source.hostname}
                    </span>
                  </span>
                </a>
              </li>
            ))}
            {orderedSources.length > visibleSources.length && (
              <li className="text-xs text-muted-foreground">
                +{orderedSources.length - visibleSources.length} more discovered
                sources
              </li>
            )}
          </ul>
        )}
      </div>
    </details>
  );
}
