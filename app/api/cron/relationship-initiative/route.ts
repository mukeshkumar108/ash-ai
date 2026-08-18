import { runServerInitiativeScan } from '@/lib/ai/relationship/outreach';

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  return Response.json(await runServerInitiativeScan());
}
