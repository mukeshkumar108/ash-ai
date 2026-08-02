'use client';

import { useFormStatus } from 'react-dom';

import { LoaderIcon } from '@/components/icons';

import { Button } from './ui/button';

export function SubmitButton({
  children,
  isSuccessful,
}: {
  children: React.ReactNode;
  isSuccessful: boolean;
}) {
  const { pending } = useFormStatus();
  const showSuccessState = pending || isSuccessful;

  return (
    <Button
      type={pending ? 'button' : 'submit'}
      aria-disabled={pending}
      disabled={pending}
      className="relative"
    >
      {children}

      {showSuccessState && (
        <span className="animate-spin absolute right-4">
          <LoaderIcon />
        </span>
      )}

      <output aria-live="polite" className="sr-only">
        {showSuccessState ? 'Loading' : 'Submit form'}
      </output>
    </Button>
  );
}
