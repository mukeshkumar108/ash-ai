export function isBeatAvailable(availableAt?: string, now = Date.now()) {
  if (!availableAt) return true;
  const dueAt = new Date(availableAt).getTime();
  return Number.isNaN(dueAt) || now >= dueAt;
}
