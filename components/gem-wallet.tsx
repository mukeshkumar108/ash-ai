'use client';

import { Gem, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

type GemStatus = {
  balance: number;
  dailyGrantCount: number;
  dailyGrantDays: number;
  dailyGrantAmount: number;
  devMode: boolean;
  devModeAvailable: boolean;
  purchasesEnabled: boolean;
  bundles: Array<{
    id: string;
    gems: number;
    amountCents: number;
    currency: string;
  }>;
};

const fetcher = (url: string) =>
  fetch(url).then((response) => {
    if (!response.ok) throw new Error('Could not load gems');
    return response.json();
  });

export function GemWallet({ expanded = false }: { expanded?: boolean }) {
  const { data, mutate } = useSWR<GemStatus>('/api/gems', fetcher, {
    revalidateOnFocus: true,
  });
  const [promoCode, setPromoCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const refresh = () => void mutate();
    window.addEventListener('gems:changed', refresh);
    return () => window.removeEventListener('gems:changed', refresh);
  }, [mutate]);

  if (!data)
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Gems
      </div>
    );
  if (!expanded) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm"
        title="Your gem balance"
      >
        <Gem className="size-4 text-violet-500" />
        <span className="font-medium">{data.balance}</span>
        <span className="text-xs text-muted-foreground">gems</span>
      </div>
    );
  }

  const post = async (url: string, body: object) => {
    setBusy(true);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Request failed');
      toast.success(payload.message ?? 'Gem wallet updated');
      await mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  const checkout = async (bundleId: string) => {
    setBusy(true);
    try {
      const response = await fetch('/api/gems/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundleId }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.url)
        throw new Error(payload.error ?? 'Checkout failed');
      window.location.assign(payload.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Checkout failed');
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <Gem className="text-violet-500" /> Gems
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use gems for image creation now, and video generation later.
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold">{data.balance}</div>
          <div className="text-xs text-muted-foreground">available</div>
        </div>
      </div>
      <p className="mt-4 text-sm">
        Daily rewards: {data.dailyGrantCount}/{data.dailyGrantDays} claimed ·{' '}
        {data.dailyGrantAmount} gems each
        {data.devMode ? ' · Developer mode active' : ''}
      </p>
      <div className="mt-4 flex gap-2">
        <input
          value={promoCode}
          onChange={(e) => setPromoCode(e.target.value)}
          placeholder="Gift or promo code"
          className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
        />
        <Button
          disabled={busy || !promoCode.trim()}
          onClick={() => void post('/api/gems/redeem', { code: promoCode })}
        >
          Redeem
        </Button>
      </div>
      {data.devModeAvailable && !data.devMode && (
        <div className="mt-3 flex gap-2">
          <input
            type="password"
            value={devCode}
            onChange={(e) => setDevCode(e.target.value)}
            placeholder="Developer access code"
            className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
          />
          <Button
            variant="outline"
            disabled={busy || !devCode}
            onClick={() => void post('/api/gems/dev', { code: devCode })}
          >
            Unlock
          </Button>
        </div>
      )}
      <div className="mt-5 grid grid-cols-3 gap-2">
        {data.bundles.map((bundle) => (
          <Button
            key={bundle.id}
            variant="outline"
            disabled={busy || !data.purchasesEnabled}
            onClick={() => void checkout(bundle.id)}
            className="h-auto flex-col py-3"
          >
            <span>{bundle.gems} gems</span>
            <span className="text-xs text-muted-foreground">
              ${(bundle.amountCents / 100).toFixed(0)}
            </span>
          </Button>
        ))}
      </div>
      {!data.purchasesEnabled && (
        <p className="mt-2 text-xs text-muted-foreground">
          Purchases will appear after Stripe test keys and a webhook are
          configured.
        </p>
      )}
    </div>
  );
}
