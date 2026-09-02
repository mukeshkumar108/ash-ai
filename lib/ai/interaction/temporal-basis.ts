export type TemporalScope = 'current_day' | 'future_explicit' | 'none';

/** Code-owned date correction for model-proposed due instants.
 *
 * The caller separately verifies that the temporal evidence is verbatim. This
 * function makes a "today/tonight/end of day" scope authoritative: the model
 * may propose a useful local clock time and offset, but cannot move the task to
 * tomorrow through date arithmetic.
 */
export function normalizeDueFromTemporalBasis(input: {
  dueIso: string;
  scope: TemporalScope | undefined;
  temporalEvidenceValid: boolean;
  referenceTime: Date;
  timeZone: string;
}): { dueIso: string | null; rejection: string | null } {
  if (
    !input.temporalEvidenceValid ||
    !input.scope ||
    input.scope === 'none'
  ) {
    return { dueIso: null, rejection: 'due_without_verbatim_temporal_basis' };
  }
  if (input.scope === 'future_explicit') {
    return { dueIso: input.dueIso, rejection: null };
  }
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: input.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(input.referenceTime);
  const timeAndOffset = input.dueIso.match(
    /T(\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!timeAndOffset) {
    return { dueIso: null, rejection: 'invalid_current_day_due' };
  }
  return {
    dueIso: `${localDate}T${timeAndOffset[1]}${timeAndOffset[2]}`,
    rejection: null,
  };
}
