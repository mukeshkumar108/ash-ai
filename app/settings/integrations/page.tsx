'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { IntegrationsPanel } from '@/components/integrations/integrations-panel';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';

function IntegrationsContent() {
  const searchParams = useSearchParams();
  const callbackReturned = searchParams.get('google') === 'connected';

  return <IntegrationsPanel callbackReturned={callbackReturned} />;
}

export default function IntegrationsPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background p-4 pb-24 md:pb-4">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Integrations</h1>
          <p className="text-muted-foreground mt-2">
            Connect external services to enhance your experience.
          </p>
          <button
            type="button"
            onClick={() => router.back()}
            className="text-muted-foreground hover:text-foreground mt-2 text-sm transition-colors"
          >
            ← Back to Chat
          </button>
        </div>
        <div className="space-y-8">
          <Suspense
            fallback={
              <div className="py-16 text-center text-sm text-muted-foreground">
                Loading integrations...
              </div>
            }
          >
            <IntegrationsContent />
          </Suspense>
        </div>
      </div>
      <MobileBottomNav />
    </div>
  );
}
