'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { toast } from '@/components/toast';
import { GemWallet } from '@/components/gem-wallet';

interface UserProfile {
  id: string;
  email: string;
  displayName: string | null;
  rpLocation: string | null;
  timeZone: string | null;
}

interface UserStats {
  chatCount: number;
  documentCount: number;
  createdAt: string;
}

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
      return;
    }

    if (status === 'authenticated' && session?.user?.id) {
      loadProfile();
      loadStats();
    }
  }, [status, session, router]);

  const loadProfile = async () => {
    try {
      const response = await fetch('/api/profile');
      if (response.ok) {
        const data = await response.json();
        setProfile(data);
      }
    } catch (error) {
      console.error('Failed to load profile:', error);
      toast({ type: 'error', description: 'Failed to load profile' });
    }
  };

  const loadStats = async () => {
    try {
      const response = await fetch('/api/profile/stats');
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!profile) return;

    setSaving(true);
    try {
      const formData = new FormData(e.currentTarget);
      const updates = {
        displayName: formData.get('displayName') as string,
        rpLocation: formData.get('rpLocation') as string,
        timeZone:
          (formData.get('timeZone') as string) ||
          Intl.DateTimeFormat().resolvedOptions().timeZone,
      };

      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (response.ok) {
        toast({
          type: 'success',
          description: 'Profile updated successfully!',
        });
        await loadProfile();
      } else {
        throw new Error('Failed to update profile');
      }
    } catch (error) {
      console.error('Failed to update profile:', error);
      toast({ type: 'error', description: 'Failed to update profile' });
    } finally {
      setSaving(false);
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading your profile...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-600">Unable to load profile</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-24 md:pb-4">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">
            Profile & Settings
          </h1>
          <p className="text-muted-foreground mt-2">
            Customize your experience and manage your preferences.
          </p>
          <button
            type="button"
            onClick={() => router.back()}
            className="mt-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to Chat
          </button>
        </div>
        <div className="space-y-8">
          <GemWallet expanded />
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-4">Account</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="timeZone"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Timezone
                </label>
                <input
                  id="timeZone"
                  name="timeZone"
                  defaultValue={
                    profile.timeZone ||
                    Intl.DateTimeFormat().resolvedOptions().timeZone
                  }
                  placeholder="Europe/London"
                  className="w-full rounded-md border border-gray-300 px-3 py-2"
                />
                <p className="mt-1 text-xs text-gray-500">
                  IANA timezone used for your local day and re-entry context.
                </p>
              </div>

              <div>
                <label
                  htmlFor="displayName"
                  className="block text-sm font-medium mb-2"
                >
                  Display Name
                </label>
                <input
                  type="text"
                  id="displayName"
                  name="displayName"
                  defaultValue={profile.displayName || ''}
                  placeholder="How you want to be displayed"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                  maxLength={100}
                />
              </div>

              <div>
                <label
                  htmlFor="rpLocation"
                  className="block text-sm font-medium mb-2"
                >
                  Default location
                </label>
                <input
                  type="text"
                  id="rpLocation"
                  name="rpLocation"
                  defaultValue={profile.rpLocation || ''}
                  placeholder="Burwell, Cambridgeshire"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                  maxLength={120}
                  autoComplete="address-level2"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Used for local weather and daylight when you don&apos;t name
                  another location in chat.
                </p>
              </div>

              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium mb-2"
                >
                  Email
                </label>
                <input
                  type="email"
                  id="email"
                  value={profile.email}
                  disabled
                  className="w-full rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Contact support if you need to change your email
                </p>
              </div>

              <SubmitButton isSuccessful={false}>
                {saving ? 'Saving...' : 'Save Changes'}
              </SubmitButton>
            </form>
          </div>

          {/* Usage Stats */}
          {stats && (
            <div className="rounded-lg border bg-card p-6 shadow-sm">
              <h2 className="text-xl font-semibold mb-4">Your Activity</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center">
                  <div className="text-3xl font-bold text-blue-600">
                    {stats.chatCount}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Chats Created
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-green-600">
                    {stats.documentCount}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Documents Generated
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-sm text-muted-foreground">
                    Member Since
                  </div>
                  <div className="text-lg font-semibold">
                    {new Date(stats.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <MobileBottomNav />
    </div>
  );
}
