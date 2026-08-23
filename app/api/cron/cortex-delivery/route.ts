import { sweepDueCortexOutbox } from '@/lib/cortex/outbox';

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const summary = await sweepDueCortexOutbox({ limit: 25 });
  return Response.json(summary);
}
