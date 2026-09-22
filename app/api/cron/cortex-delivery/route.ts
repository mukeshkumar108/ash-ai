import {
  requeueBlockedCortexOutbox,
  sweepDueCortexOutbox,
} from '@/lib/cortex/outbox';
import {
  requeueBlockedCandidateReceiptOutbox,
  sweepDueCandidateReceiptOutbox,
} from '@/lib/cortex/candidate-receipt-outbox';
import { withWorkerHeartbeat } from '@/lib/observability/worker-heartbeat';

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  if (action === 'requeue') {
    // Explicit recovery path after Cortex configuration repair: moves blocked
    // rows back to pending. Run only once config is healthy.
    return Response.json(
      await withWorkerHeartbeat('cortex-delivery', async () => ({
        turns: await requeueBlockedCortexOutbox(),
        candidateReceipts: await requeueBlockedCandidateReceiptOutbox(),
      })),
    );
  }
  return Response.json(
    await withWorkerHeartbeat('cortex-delivery', async () => ({
      turns: await sweepDueCortexOutbox({ limit: 25 }),
      candidateReceipts: await sweepDueCandidateReceiptOutbox({ limit: 25 }),
    })),
  );
}
