export function isBeatAvailable(availableAt?: string, now = Date.now()) {
  if (!availableAt) return true;
  const dueAt = new Date(availableAt).getTime();
  return Number.isNaN(dueAt) || now >= dueAt;
}

export function isBeatVisible(
  availableAt?: string,
  cancelledAt?: string,
  now = Date.now(),
) {
  return !cancelledAt && isBeatAvailable(availableAt, now);
}

type UnknownPart = { type?: unknown; data?: unknown; [key: string]: unknown };

function deliveryData(part: UnknownPart) {
  if (part.type !== 'data-beatDelivery' || !part.data || typeof part.data !== 'object') return null;
  return part.data as { availableAt?: string; cancelledAt?: string };
}

export function cancelPendingBeatDeliveries(parts: unknown, now: Date) {
  if (!Array.isArray(parts)) return { parts, changed: false };
  let changed = false;
  const next = parts.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const part = raw as UnknownPart;
    const data = deliveryData(part);
    if (!data || data.cancelledAt || isBeatAvailable(data.availableAt, now.getTime())) return raw;
    changed = true;
    return { ...part, data: { ...data, cancelledAt: now.toISOString() } };
  });
  return { parts: next, changed };
}

export function visibleMessagePartsAt(parts: unknown, now: Date): unknown {
  if (!Array.isArray(parts)) return parts;
  const visible: unknown[] = [];
  let hideNextText = false;
  for (const raw of parts) {
    if (!raw || typeof raw !== 'object') {
      if (!hideNextText) visible.push(raw);
      continue;
    }
    const part = raw as UnknownPart;
    const data = deliveryData(part);
    if (data) {
      hideNextText = !isBeatVisible(data.availableAt, data.cancelledAt, now.getTime());
      if (!hideNextText) visible.push(raw);
      continue;
    }
    if (part.type === 'text' && hideNextText) {
      hideNextText = false;
      continue;
    }
    visible.push(raw);
  }
  return visible;
}
