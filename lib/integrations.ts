export interface GoogleCapabilities {
  gmailAuthorized: boolean;
  calendarAuthorized: boolean;
}

export interface GoogleConnectionStatusResult {
  connected: boolean;
  google_email: string | null;
  granted_scopes: string[] | null;
  status: string;
}

export interface IntegrationsGoogleStatusResponse {
  available: boolean;
  connected: boolean;
  googleEmail: string | null;
  gmailAuthorized: boolean;
  calendarAuthorized: boolean;
  status: string;
}

export interface GmailMessageSummary {
  messageId: string;
  threadId: string;
  sender: string;
  recipients: string[];
  subject: string;
  date: string;
  snippet: string;
  labelIds: string[];
  isUnread: boolean;
}

export interface GmailAttachmentMetadata {
  attachmentId: string | null;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
}

export interface GmailThreadMessage {
  messageId: string;
  sender: string;
  recipients: string[];
  cc: string[];
  subject: string;
  date: string;
  plainTextBody: string | null;
  htmlBody: string | null;
  attachments: GmailAttachmentMetadata[];
}

export interface GmailThreadDetail {
  threadId: string;
  messages: GmailThreadMessage[];
}

export interface CalendarEvent {
  eventId: string;
  calendarId: string;
  status: string;
  title: string;
  description: string | null;
  location: string | null;
  start: string | null;
  end: string | null;
  startDate: string | null;
  endDate: string | null;
  timeZone: string | null;
  allDay: boolean;
  htmlLink: string | null;
}

export interface CalendarEventsResult {
  calendarId: string;
  events: CalendarEvent[];
}

export interface GmailDraftCreateInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  plainTextBody?: string | null;
  htmlBody?: string | null;
  replyToMessageId?: string | null;
  threadId?: string | null;
}

export interface GmailDraftUpdateInput {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  plainTextBody?: string | null;
  htmlBody?: string | null;
}

export interface GmailDraftDetail {
  draftId: string;
  messageId: string;
  threadId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  plainTextBody: string | null;
  htmlBody: string | null;
}

export type CalendarEventCreateInput =
  | {
      kind: 'timed';
      title: string;
      description?: string | null;
      location?: string | null;
      start: string;
      end: string;
      timeZone: string;
    }
  | {
      kind: 'allDay';
      title: string;
      description?: string | null;
      location?: string | null;
      startDate: string;
      endDate: string;
    };

export interface CalendarEventUpdateInput {
  title?: string;
  description?: string | null;
  location?: string | null;
  start?: string;
  end?: string;
  timeZone?: string;
  startDate?: string;
  endDate?: string;
}

export type IntegrationFailureReason =
  | 'unavailable'
  | 'not_connected'
  | 'revoked'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invalid';

export type IntegrationDataResponse<T> =
  | { ok: true; data: T }
  | { ok: false; reason: IntegrationFailureReason };

const GMAIL_MESSAGES_LIMIT_MIN = 1;
const GMAIL_MESSAGES_LIMIT_MAX = 20;
const GMAIL_QUERY_MAX_LENGTH = 256;
const GMAIL_MESSAGES_LIMIT_DEFAULT = 10;
const THREAD_ID_MAX_LENGTH = 255;

const UPSTREAM_ERROR_TO_REASON: Record<string, IntegrationFailureReason> = {
  not_connected: 'not_connected',
  revoked: 'revoked',
  forbidden: 'forbidden',
  not_found: 'not_found',
  conflict: 'conflict',
  invalid: 'invalid',
  unavailable: 'unavailable',
  unauthorized: 'unavailable',
  invalid_response: 'unavailable',
};

export type GmailMessagesQuery =
  | { ok: true; limit: number; query: string | null }
  | { ok: false; error: 'invalid_limit' | 'invalid_query' };

export function deriveGoogleCapabilities(
  grantedScopes: string[] | null,
): GoogleCapabilities {
  const scopes = grantedScopes ?? [];

  return {
    gmailAuthorized: scopes.some(
      (scope) =>
        scope.startsWith('gmail.') ||
        scope.includes('/auth/gmail') ||
        scope === 'https://mail.google.com/',
    ),
    calendarAuthorized: scopes.some(
      (scope) =>
        scope.startsWith('calendar') || scope.includes('/auth/calendar'),
    ),
  };
}

export function buildIntegrationsStatusResponse(
  result: GoogleConnectionStatusResult,
): IntegrationsGoogleStatusResponse {
  const { gmailAuthorized, calendarAuthorized } = deriveGoogleCapabilities(
    result.granted_scopes,
  );

  return {
    available: true,
    connected: result.connected,
    googleEmail: result.google_email,
    gmailAuthorized,
    calendarAuthorized,
    status: result.status,
  };
}

export function parseGmailMessagesQuery(
  limit: string | null,
  query: string | null,
): GmailMessagesQuery {
  let parsedLimit = GMAIL_MESSAGES_LIMIT_DEFAULT;

  if (limit !== null && limit !== '') {
    const numeric = Number(limit);

    if (
      !Number.isInteger(numeric) ||
      numeric < GMAIL_MESSAGES_LIMIT_MIN ||
      numeric > GMAIL_MESSAGES_LIMIT_MAX
    ) {
      return { ok: false, error: 'invalid_limit' };
    }

    parsedLimit = numeric;
  }

  if (query !== null && query.length > GMAIL_QUERY_MAX_LENGTH) {
    return { ok: false, error: 'invalid_query' };
  }

  return {
    ok: true,
    limit: parsedLimit,
    query: query !== null && query.length > 0 ? query : null,
  };
}

export function validateThreadId(threadId: string): string | null {
  return validateOpaqueId(threadId);
}

export function validateOpaqueId(id: string): string | null {
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    id.length > THREAD_ID_MAX_LENGTH ||
    id.includes('/') ||
    id.includes('\\') ||
    id === '.' ||
    id === '..'
  ) {
    return null;
  }

  return id;
}

export function validateGmailDraftCreate(input: {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  plainTextBody?: string | null;
  htmlBody?: string | null;
}): { ok: true } | { ok: false; error: 'no_recipient' | 'no_body' } {
  const recipientCount =
    (input.to ?? []).length +
    (input.cc ?? []).length +
    (input.bcc ?? []).length;

  if (recipientCount === 0) {
    return { ok: false, error: 'no_recipient' };
  }

  const hasBody = Boolean(
    (input.plainTextBody ?? '').trim() || (input.htmlBody ?? '').trim(),
  );

  if (!hasBody) {
    return { ok: false, error: 'no_body' };
  }

  return { ok: true };
}

export function validateGmailDraftUpdate(
  input: GmailDraftUpdateInput,
): { ok: true } | { ok: false; error: 'no_body' } {
  const providedBodies = [input.plainTextBody, input.htmlBody].filter(
    (value): value is string => typeof value === 'string',
  );

  if (
    providedBodies.length > 0 &&
    !providedBodies.some((value) => value.trim())
  ) {
    return { ok: false, error: 'no_body' };
  }

  return { ok: true };
}

export type CalendarEventValidationError =
  | 'mixed_event_type'
  | 'missing_event_time'
  | 'invalid_time_range'
  | 'invalid_date_range';

export type CalendarEventCreateParse =
  | { ok: true; value: CalendarEventCreateInput }
  | { ok: false; error: CalendarEventValidationError };

interface CalendarEventFields {
  title: string;
  description?: string | null;
  location?: string | null;
  start?: string;
  end?: string;
  timeZone?: string;
  startDate?: string;
  endDate?: string;
}

export function resolveCalendarEventCreate(
  body: CalendarEventFields,
): CalendarEventCreateParse {
  const hasTimed =
    body.start !== undefined ||
    body.end !== undefined ||
    body.timeZone !== undefined;
  const hasAllDay = body.startDate !== undefined || body.endDate !== undefined;

  if (hasTimed && hasAllDay) {
    return { ok: false, error: 'mixed_event_type' };
  }

  if (hasTimed) {
    if (
      body.start === undefined ||
      body.end === undefined ||
      body.timeZone === undefined
    ) {
      return { ok: false, error: 'missing_event_time' };
    }

    if (Date.parse(body.start) >= Date.parse(body.end)) {
      return { ok: false, error: 'invalid_time_range' };
    }

    return {
      ok: true,
      value: {
        kind: 'timed',
        title: body.title,
        description: body.description ?? null,
        location: body.location ?? null,
        start: body.start,
        end: body.end,
        timeZone: body.timeZone,
      },
    };
  }

  if (hasAllDay) {
    if (body.startDate === undefined || body.endDate === undefined) {
      return { ok: false, error: 'missing_event_time' };
    }

    // Google all-day event end dates are exclusive, so the end must be
    // strictly after the start.
    if (body.startDate >= body.endDate) {
      return { ok: false, error: 'invalid_date_range' };
    }

    return {
      ok: true,
      value: {
        kind: 'allDay',
        title: body.title,
        description: body.description ?? null,
        location: body.location ?? null,
        startDate: body.startDate,
        endDate: body.endDate,
      },
    };
  }

  return { ok: false, error: 'missing_event_time' };
}

export type CalendarEventUpdateParse =
  | { ok: true; value: CalendarEventUpdateInput }
  | { ok: false; error: CalendarEventValidationError };

export function resolveCalendarEventUpdate(
  body: CalendarEventUpdateInput,
): CalendarEventUpdateParse {
  const hasTimed =
    body.start !== undefined ||
    body.end !== undefined ||
    body.timeZone !== undefined;
  const hasAllDay = body.startDate !== undefined || body.endDate !== undefined;

  if (hasTimed && hasAllDay) {
    return { ok: false, error: 'mixed_event_type' };
  }

  if (hasTimed) {
    if (body.start === undefined || body.end === undefined) {
      return { ok: false, error: 'missing_event_time' };
    }

    if (Date.parse(body.start) >= Date.parse(body.end)) {
      return { ok: false, error: 'invalid_time_range' };
    }
  } else if (hasAllDay) {
    if (body.startDate === undefined || body.endDate === undefined) {
      return { ok: false, error: 'missing_event_time' };
    }

    if (body.startDate >= body.endDate) {
      return { ok: false, error: 'invalid_date_range' };
    }
  }

  return { ok: true, value: body };
}

export function integrationFailureReason(
  code: string,
): IntegrationFailureReason {
  return UPSTREAM_ERROR_TO_REASON[code] ?? 'unavailable';
}

export function describeIntegrationFailure(
  reason: IntegrationFailureReason,
): string {
  switch (reason) {
    case 'not_connected':
      return 'Google is not connected. Connect Google to see your data.';
    case 'revoked':
      return 'The Google connection has been revoked. Reconnect Google to continue.';
    case 'forbidden':
      return 'Google denied access to this data. Check the granted permissions.';
    case 'not_found':
      return 'The requested item was not found.';
    case 'conflict':
      return 'This request conflicts with a previously submitted one. Start a fresh draft or event and try again.';
    case 'invalid':
      return 'Google rejected this request. Check the values and try again.';
    case 'unavailable':
    default:
      return 'The Google connection service is currently unavailable. Please try again later.';
  }
}

export function describeWriteError(code: string): string {
  switch (code) {
    case 'invalid_recipient':
      return 'One or more recipient email addresses are invalid.';
    case 'no_recipient':
      return 'At least one recipient is required.';
    case 'no_body':
      return 'A plain-text body is required.';
    case 'invalid_subject':
      return 'The subject is too long or contains line breaks.';
    case 'invalid_body':
      return 'The message body is too long.';
    case 'invalid_datetime':
      return 'Dates and times must be valid RFC 3339 values.';
    case 'invalid_date':
      return 'The all-day date is invalid.';
    case 'invalid_time_range':
      return 'The event start must be before its end.';
    case 'invalid_date_range':
      return 'The all-day end date must not be before its start date.';
    case 'mixed_event_type':
      return 'Use either timed fields or all-day fields, not both.';
    case 'missing_event_time':
      return 'Provide both a start and end time.';
    case 'missing_event_title':
      return 'An event title is required.';
    case 'invalid_event_title':
      return 'The event title is too long.';
    case 'invalid_event_description':
      return 'The event description is too long.';
    case 'invalid_event_location':
      return 'The event location is too long.';
    case 'invalid_time_zone':
      return 'The time zone is invalid.';
    case 'invalid_operation_id':
      return 'The create request is missing a valid operation ID.';
    case 'invalid_thread_reference':
      return 'The reply draft references an invalid message or thread.';
    case 'invalid_draft_id':
      return 'The draft ID is invalid.';
    case 'invalid_event_id':
      return 'The event ID is invalid.';
    case 'invalid_request':
      return 'The request contains unrecognised or invalid fields.';
    default:
      return 'The form contains invalid values.';
  }
}

const EMAIL_INSIDE_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export function extractEmailAddress(value: string): string | null {
  const match = value.match(EMAIL_INSIDE_PATTERN);
  return match ? match[0] : null;
}

export function replySubject(original: string): string {
  if (/^\s*re:/i.test(original)) {
    return original.trim();
  }

  return `Re: ${original.trim()}`;
}

export function parseRecipientList(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const ALLOWED_CALENDAR_LINK_TARGETS: ReadonlyArray<{
  hostname: string;
  pathname: string;
}> = [
  // Legacy host returned by the Google Calendar API in htmlLink.
  { hostname: 'www.google.com', pathname: '/calendar/event' },
  // Modern Google Calendar host.
  { hostname: 'calendar.google.com', pathname: '/calendar/event' },
  // Short event URL shape used by the workspace-connect contract fixtures.
  { hostname: 'calendar.google.com', pathname: '/event' },
];

export function safeGoogleCalendarUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);

    if (parsed.protocol !== 'https:') {
      return null;
    }

    const allowed = ALLOWED_CALENDAR_LINK_TARGETS.some(
      (target) =>
        parsed.hostname === target.hostname &&
        parsed.pathname === target.pathname,
    );

    if (!allowed) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export function zonedDateTimeToIso(
  date: string,
  time: string,
  timeZone: string,
): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    return '';
  }

  const naive = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  if (Number.isNaN(naive.getTime())) {
    return '';
  }

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(naive);

    const field = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? '';

    const asUtc = Date.UTC(
      Number(field('year')),
      Number(field('month')) - 1,
      Number(field('day')),
      Number(field('hour')) % 24,
      Number(field('minute')),
      Number(field('second')),
    );

    const instant = new Date(2 * naive.getTime() - asUtc);
    return instant.toISOString();
  } catch {
    return '';
  }
}

export function addCalendarDays(isoDate: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || !Number.isInteger(days)) {
    return '';
  }

  const [year, month, day] = isoDate.split('-').map(Number);
  const utc = Date.UTC(year, month - 1, day + days);

  if (Number.isNaN(utc)) {
    return '';
  }

  return new Date(utc).toISOString().slice(0, 10);
}

export type WriteResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason?: IntegrationFailureReason; error?: string };

export async function writeRequest<T>(
  url: string,
  init: RequestInit,
): Promise<WriteResult<T>> {
  try {
    const response = await fetch(url, init);
    const body: unknown = await response.json().catch(() => null);

    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>;

      if (record.ok === true) {
        return { ok: true, data: record.data as T };
      }

      if (record.ok === false) {
        if (typeof record.reason === 'string') {
          return {
            ok: false,
            reason: record.reason as IntegrationFailureReason,
          };
        }

        if (typeof record.error === 'string') {
          return { ok: false, error: record.error };
        }
      }
    }

    return { ok: false, reason: 'unavailable' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export function writeErrorMessage(result: WriteResult<unknown>): string {
  if (!result.ok) {
    if (result.error) {
      return describeWriteError(result.error);
    }

    if (result.reason) {
      return describeIntegrationFailure(result.reason);
    }
  }

  return 'Something went wrong. Please try again.';
}

export function extractPlainTextFromHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function getThreadMessagePlainText(message: GmailThreadMessage): string {
  if (message.plainTextBody && message.plainTextBody.length > 0) {
    return message.plainTextBody;
  }

  if (message.htmlBody && message.htmlBody.length > 0) {
    return extractPlainTextFromHtml(message.htmlBody);
  }

  return '(no body)';
}

export function formatGmailMessageDate(date: string): string {
  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatCalendarDateTime(value: Date): string {
  return value.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function calendarEventTimeLabel(event: CalendarEvent): string {
  if (event.allDay) {
    return event.startDate ? `${event.startDate} (all day)` : 'All day';
  }

  if (!event.start) {
    return event.startDate ?? 'No time set';
  }

  const start = new Date(event.start);

  if (event.end) {
    const end = new Date(event.end);

    if (end.getTime() !== start.getTime()) {
      return `${formatCalendarDateTime(start)} – ${formatCalendarDateTime(end)}`;
    }
  }

  return formatCalendarDateTime(start);
}
