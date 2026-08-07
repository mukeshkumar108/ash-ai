import type { ResearchActivity, ResearchTrace } from '@/lib/types';

function searchKindLabel(kind: ResearchActivity['kind']): string {
  if (kind === 'page') return 'page read';
  if (kind === 'news') return 'news search';
  if (kind === 'video') return 'video search';
  if (kind === 'image') return 'image search';
  if (kind === 'place') return 'place search';
  return 'web search';
}

export function summarizeResearchTrace(trace: ResearchTrace): string {
  const successful = trace.activities.filter(
    (activity) => activity.status !== 'failed',
  );
  const failed = trace.activities.filter(
    (activity) => activity.status === 'failed',
  );
  const searchActivities = successful.filter(
    (activity) => activity.kind !== 'page',
  );
  const pageCount = successful.filter(
    (activity) => activity.kind === 'page',
  ).length;
  const callCount = searchActivities.length;
  const resultCount = trace.activities.reduce(
    (total, activity) =>
      activity.kind === 'page' ? total : total + (activity.resultCount ?? 0),
    0,
  );

  const labels: string[] = [];
  if (callCount === 1) {
    labels.push(`1 ${searchKindLabel(searchActivities[0].kind)}`);
  } else if (callCount > 1) {
    labels.push(`${callCount} searches`);
  }
  if (pageCount > 0)
    labels.push(`${pageCount} ${pageCount === 1 ? 'page' : 'pages'} read`);
  if (failed.length > 0) {
    labels.push(
      `${failed.length} ${failed.length === 1 ? 'retrieval' : 'retrievals'} failed`,
    );
  }
  const citedCount = trace.sources.filter((source) => source.cited).length;
  if (citedCount > 0) {
    labels.push(
      `${citedCount} ${citedCount === 1 ? 'source' : 'sources'} cited`,
    );
  }
  const callLabel = labels.join(' · ');

  if (resultCount > 0) {
    return `${callLabel} · ${resultCount} ${resultCount === 1 ? 'result' : 'results'} returned`;
  }

  return callLabel;
}
