/** Tells the Companion Runtime that a person's task list changed, so their prepared day can look again. Fire and forget: failure here never touches the change. */
export async function announceTasksChanged(userId: string | undefined) {
  const baseUrl = process.env.COMPANION_RUNTIME_URL?.trim().replace(/\/$/u, '');
  const secret = process.env.COMPANION_RUNTIME_SECRET?.trim();
  if (!userId || !baseUrl || !secret) return;
  try {
    await fetch(`${baseUrl}/v1/users/${encodeURIComponent(userId)}/awareness/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Companion-Runtime-Key': secret },
      body: JSON.stringify({ companion_id: 'sophie', source: 'things' }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    /* the reconciliation probe will find it */
  }
}
