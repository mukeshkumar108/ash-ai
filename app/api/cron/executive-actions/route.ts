import { runExecutiveActionSweep } from '@/lib/ai/executive-actions';
import { withWorkerHeartbeat } from '@/lib/observability/worker-heartbeat';

export const maxDuration = 120;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  return Response.json(
    await withWorkerHeartbeat('executive-actions', () =>
      runExecutiveActionSweep(),
    ),
  );
}
