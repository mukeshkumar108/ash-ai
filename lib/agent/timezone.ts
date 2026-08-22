export const DEFAULT_USER_TIME_ZONE = 'Europe/London';

export function isIanaTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function resolveUserTimeZone(value: unknown): string {
  return isIanaTimeZone(value) ? value : DEFAULT_USER_TIME_ZONE;
}
