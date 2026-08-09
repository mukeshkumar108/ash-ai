import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import { getGemBundle } from '@/lib/gems/catalog';
import { getStripe } from '@/lib/gems/stripe';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const bundle =
    body && typeof body.bundleId === 'string'
      ? getGemBundle(body.bundleId)
      : undefined;
  if (!bundle)
    return NextResponse.json({ error: 'Unknown gem bundle.' }, { status: 400 });
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: 'Gem purchases are not configured yet.' },
      { status: 503 },
    );
  }
  const origin = process.env.APP_URL ?? new URL(request.url).origin;
  const checkout = await getStripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: session.user.email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: bundle.currency,
          unit_amount: bundle.amountCents,
          product_data: { name: `${bundle.gems} gems` },
        },
      },
    ],
    metadata: { userId: session.user.id, bundleId: bundle.id },
    success_url: `${origin}/profile?gems=purchased`,
    cancel_url: `${origin}/profile?gems=cancelled`,
  });
  return NextResponse.json({ url: checkout.url });
}
