'use client';

import { useRouter } from 'next/navigation';

import { GoogleDataPage } from '@/components/integrations/google-data';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';

export default function GoogleIntegrationsPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background p-4 pb-24 md:pb-4">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">
            Gmail &amp; Calendar
          </h1>
          <p className="text-muted-foreground mt-2">
            Read-only preview from your connected Google account.
          </p>
          <button
            type="button"
            onClick={() => router.back()}
            className="text-muted-foreground hover:text-foreground mt-2 text-sm transition-colors"
          >
            ← Back
          </button>
        </div>
        <GoogleDataPage />
      </div>
      <MobileBottomNav />
    </div>
  );
}
