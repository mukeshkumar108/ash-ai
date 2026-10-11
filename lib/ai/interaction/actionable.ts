/**
 * Deterministic pre-filter for the fast-path commitment interpreter (INTERIM).
 *
 * The interpreter model call runs per turn today with no gating. Most turns contain
 * nothing actionable and the model refuses them anyway ("Ambiguous or implicit material
 * is deliberately refused") — so the call is pure spend. This predicate skips those
 * turns with zero model cost. It is deliberately BIASED TO RUN: anything resembling a
 * task verb, noun, affirmation-after-proposal, or temporal commitment language runs
 * the model. A false run costs one call (status quo); a false skip loses a task.
 *
 * Deletion pointer: remove this entire module when the shared execution service owns
 * task creation (Addendum A step 2b/5b) — the Runtime mutation tool + interpreter
 * backstop then cover every path below.
 */

const TASK_SIGNALS = [
  /remind/i,
  /remember to\b/i,
  /\btask\b/i,
  /\btodo\b/i,
  /to-?do/i,
  /cancel/i,
  /\bdone\b/i,
  /complet/i,
  /finish/i,
  /snooz/i,
  /reschedul/i,
  /postpon/i,
  /appointment/i,
  /meeting/i,
  /invoice/i,
  /\bpay\b/i,
  /deadline/i,
  /\bdue\b/i,
  /book\b/i,
  /schedul/i,
  /alarm/i,
  /forget\b/i,
  /forgot\b/i,
  /outstanding/i,
  /\bowe\b/i,
  /promise/i,
  /deadline/i,
  /dentist/i,
  /doctor/i,
  /flight/i,
  /call back/i,
  /ring back/i,
  /mov(e|ed|ing)\b/i,
  /might (work|do)/i,
  /could (work|do)/i,
  /what about/i,
  /how about/i,
  /instead/i,
];

/** Short affirmatives that only mean something after the assistant proposed an action. */
const BARE_AFFIRMATIVE = /^(yes|yeah|yep|yup|ok|okay|sure|please do|do it|go ahead|sounds good|perfect|great|thanks|thank you)[\s!.]*$/i;

/** Assistant proposed or reported an action, so a bare "yes" may bind to it. */
const ASSISTANT_PROPOSAL = /i('| a)m (going to|gonna)|i('| a)ll (set|add|book|schedule|create|remind)|i('| ha)ve (set|added|booked|scheduled)|reminder( set|s scheduled)?|scheduled( for| at)?|booked( for| at)?|shall i|want me to|should i (set|add|book|remind)/i;

export function userHasTaskSignal(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  return TASK_SIGNALS.some((re) => re.test(t));
}

export function turnLooksActionable(userText: string, assistantText: string): boolean {
  const user = (userText || '').trim();
  if (!user) return false;
  if (userHasTaskSignal(user) || userHasTaskSignal(assistantText || '')) return true;
  if (BARE_AFFIRMATIVE.test(user) && ASSISTANT_PROPOSAL.test(assistantText || '')) return true;
  return false;
}
