import { NextResponse } from 'next/server';

import { fulfillGemPurchase } from '@/lib/gems/service';
import { getStripe } from '@/lib/gems/stripe';

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret)
    return NextResponse.json(
      { error: 'Webhook not configured' },
      { status: 400 },
    );
  let event;
  try {
    event = getStripe().webhooks.constructEvent(
      await request.text(),
      signature,
      secret,
    );
  } catch {
    return NextResponse.json(
      { error: 'Invalid webhook signature' },
      { status: 400 },
    );
  }
  if (event.type === 'checkout.session.completed') {
    const checkout = event.data.object;
    const { userId, bundleId } = checkout.metadata ?? {};
    if (
      checkout.payment_status === 'paid' &&
      userId &&
      bundleId &&
      checkout.amount_total !== null
    ) {
      await fulfillGemPurchase({
        userId,
        bundleId,
        checkoutSessionId: checkout.id,
        amountPaidCents: checkout.amount_total,
        currency: checkout.currency ?? 'usd',
      });
    }
  }
  return NextResponse.json({ received: true });
}
