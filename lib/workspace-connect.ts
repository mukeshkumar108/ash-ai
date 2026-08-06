import 'server-only';

import { createHmac, randomUUID } from 'node:crypto';

import type {
  CalendarEvent,
  CalendarEventCreateInput,
  CalendarEventsResult,
  CalendarEventUpdateInput,
  GmailAttachmentMetadata,
  GmailDraftCreateInput,
  GmailDraftDetail,
  GmailDraftUpdateInput,
  GmailMessageSummary,
  GmailThreadDetail,
  GmailThreadMessage,
  GoogleConnectionStatusResult,
} from '@/lib/integrations';
import { validateOpaqueId } from '@/lib/integrations';

const PURPOSE_API_ACCESS = 'api_access';
const PURPOSE_GOOGLE_CONNECT = 'google_connect';
const TOKEN_TTL_SECONDS = 5 * 60;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_IDENTITY_VALUE_LENGTH = 255;
const IDENTITY_VALUE_PATTERN = /^[A-Za-z0-9._@-]+$/;
const GMAIL_MESSAGES_LIMIT_DEFAULT = 10;
const GMAIL_MESSAGES_LIMIT_MAX = 20;
const CALENDAR_DAYS_DEFAULT = 7;
const CALENDAR_DAYS_MAX = 30;
const CALENDAR_EVENTS_LIMIT_DEFAULT = 50;
const CALENDAR_EVENTS_LIMIT_MAX = 50;

export type WorkspaceConnectErrorCode =
  | 'unavailable'
  | 'unauthorized'
  | 'forbidden'
  | 'invalid_response'
  | 'revoked'
  | 'not_connected'
  | 'not_found'
  | 'conflict'
  | 'invalid';

export class WorkspaceConnectError extends Error {
  readonly code: WorkspaceConnectErrorCode;

  constructor(code: WorkspaceConnectErrorCode, message: string) {
    super(message);
    this.name = 'WorkspaceConnectError';
    this.code = code;
  }
}

interface WorkspaceConnectConfig {
  baseUrl: string;
  signingSecret: string;
  applicationId: string;
  returnUrl: string;
}

function getConfig(): WorkspaceConnectConfig {
  const baseUrl = process.env.WORKSPACE_CONNECT_BASE_URL;
  const signingSecret = process.env.WORKSPACE_CONNECT_SIGNING_SECRET;
  const returnUrl = process.env.WORKSPACE_CONNECT_RETURN_URL;

  if (!baseUrl) {
    throw new WorkspaceConnectError(
      'unavailable',
      'WORKSPACE_CONNECT_BASE_URL is not configured',
    );
  }

  if (!signingSecret) {
    throw new WorkspaceConnectError(
      'unavailable',
      'WORKSPACE_CONNECT_SIGNING_SECRET is not configured',
    );
  }

  if (Buffer.byteLength(signingSecret, 'utf8') < 32) {
    throw new WorkspaceConnectError(
      'unavailable',
      'WORKSPACE_CONNECT_SIGNING_SECRET must be at least 32 bytes',
    );
  }

  if (!returnUrl) {
    throw new WorkspaceConnectError(
      'unavailable',
      'WORKSPACE_CONNECT_RETURN_URL is not configured',
    );
  }

  return {
    baseUrl,
    signingSecret,
    applicationId: assertApplicationId(
      process.env.WORKSPACE_CONNECT_APPLICATION_ID || 'ash-test',
    ),
    returnUrl,
  };
}

function assertAuthenticatedUserId(authenticatedUserId: string): string {
  if (
    typeof authenticatedUserId !== 'string' ||
    authenticatedUserId.length === 0 ||
    authenticatedUserId.length > MAX_IDENTITY_VALUE_LENGTH ||
    !IDENTITY_VALUE_PATTERN.test(authenticatedUserId)
  ) {
    throw new WorkspaceConnectError(
      'forbidden',
      'authenticatedUserId is not supported by workspace-connect',
    );
  }

  return authenticatedUserId;
}

function assertApplicationId(applicationId: string): string {
  if (
    applicationId.length === 0 ||
    applicationId.length > MAX_IDENTITY_VALUE_LENGTH ||
    !IDENTITY_VALUE_PATTERN.test(applicationId)
  ) {
    throw new WorkspaceConnectError(
      'unavailable',
      'WORKSPACE_CONNECT_APPLICATION_ID is invalid',
    );
  }

  return applicationId;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function signHs256(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');

  return `${signingInput}.${signature}`;
}

function createIdentityToken(
  config: WorkspaceConnectConfig,
  externalUserId: string,
  purpose: 'api_access' | 'google_connect',
  options: { returnUrl?: string } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    application_id: config.applicationId,
    external_user_id: externalUserId,
    purpose,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
    jti: randomUUID(),
  };

  if (options.returnUrl) {
    payload.return_url = options.returnUrl;
  }

  return signHs256(payload, config.signingSecret);
}

function createApiAccessToken(
  config: WorkspaceConnectConfig,
  externalUserId: string,
): string {
  return createIdentityToken(config, externalUserId, PURPOSE_API_ACCESS);
}

async function workspaceConnectFetch(
  config: WorkspaceConnectConfig,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new WorkspaceConnectError(
        'unavailable',
        'workspace-connect request timed out',
      );
    }

    throw new WorkspaceConnectError(
      'unavailable',
      'workspace-connect is unreachable',
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

function isIdentityRejection(status: number): boolean {
  return status === 401 || status === 403;
}

export async function getGoogleConnectionStatus(
  authenticatedUserId: string,
): Promise<GoogleConnectionStatusResult> {
  assertAuthenticatedUserId(authenticatedUserId);
  const config = getConfig();
  const token = createApiAccessToken(config, authenticatedUserId);

  const response = await workspaceConnectFetch(
    config,
    `${config.baseUrl}/google/status`,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    },
  );

  if (isIdentityRejection(response.status)) {
    throw new WorkspaceConnectError(
      response.status === 403 ? 'forbidden' : 'unauthorized',
      'workspace-connect rejected the identity token',
    );
  }

  if (!response.ok) {
    throw new WorkspaceConnectError(
      'unavailable',
      `workspace-connect status failed with HTTP ${response.status}`,
    );
  }

  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw new WorkspaceConnectError(
      'invalid_response',
      'workspace-connect returned an invalid status response',
    );
  }

  const record = body as Record<string, unknown>;
  const connected = record.connected === true;
  const grantedScopes = Array.isArray(record.granted_scopes)
    ? record.granted_scopes.filter(
        (scope): scope is string => typeof scope === 'string',
      )
    : null;

  return {
    connected,
    google_email:
      typeof record.google_email === 'string' ? record.google_email : null,
    granted_scopes: grantedScopes,
    status:
      typeof record.status === 'string'
        ? record.status
        : connected
          ? 'active'
          : 'not_connected',
  };
}

export function createGoogleConnectUrl(authenticatedUserId: string): string {
  assertAuthenticatedUserId(authenticatedUserId);
  const config = getConfig();
  const token = createIdentityToken(
    config,
    authenticatedUserId,
    PURPOSE_GOOGLE_CONNECT,
    {
      returnUrl: config.returnUrl,
    },
  );

  return `${config.baseUrl}/google/connect?token=${encodeURIComponent(token)}`;
}

export async function disconnectGoogle(
  authenticatedUserId: string,
): Promise<void> {
  assertAuthenticatedUserId(authenticatedUserId);
  const config = getConfig();
  const token = createApiAccessToken(config, authenticatedUserId);

  const response = await workspaceConnectFetch(
    config,
    `${config.baseUrl}/google/connection`,
    {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    },
  );

  if (isIdentityRejection(response.status)) {
    throw new WorkspaceConnectError(
      response.status === 403 ? 'forbidden' : 'unauthorized',
      'workspace-connect rejected the identity token',
    );
  }

  // Already disconnected is a successful outcome for the caller.
  if (response.status === 404) {
    return;
  }

  if (!response.ok) {
    throw new WorkspaceConnectError(
      'unavailable',
      `workspace-connect disconnect failed with HTTP ${response.status}`,
    );
  }
}

export interface GmailMessagesOptions {
  limit?: number;
  query?: string;
}

export interface UpcomingCalendarEventsOptions {
  days?: number;
  limit?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function strList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function normalizeLimit(
  limit: number | undefined,
  fallback: number,
  max: number,
): number {
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
    return fallback;
  }

  return Math.min(limit, max);
}

function toDataError(
  response: Response,
  missingResource: 'not_connected' | 'not_found',
): WorkspaceConnectError {
  if (response.status === 401) {
    return new WorkspaceConnectError(
      'revoked',
      'Google connection is revoked or expired',
    );
  }

  if (response.status === 403) {
    return new WorkspaceConnectError(
      'forbidden',
      'Google denied access with the current permissions',
    );
  }

  if (response.status === 404) {
    return new WorkspaceConnectError(
      missingResource,
      'The requested Google resource was not found',
    );
  }

  if (response.status === 429) {
    return new WorkspaceConnectError(
      'unavailable',
      'Google rate limit reached',
    );
  }

  return new WorkspaceConnectError(
    'unavailable',
    `workspace-connect request failed with HTTP ${response.status}`,
  );
}

async function fetchWorkspaceConnectData(
  config: WorkspaceConnectConfig,
  authenticatedUserId: string,
  path: string,
  missingResource: 'not_connected' | 'not_found',
): Promise<unknown> {
  const token = createApiAccessToken(config, authenticatedUserId);

  const response = await workspaceConnectFetch(
    config,
    `${config.baseUrl}${path}`,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    throw toDataError(response, missingResource);
  }

  return response.json().catch(() => null);
}

export function parseGmailMessagesResponse(
  body: unknown,
): GmailMessageSummary[] {
  const record = asRecord(body);

  if (!record || !Array.isArray(record.messages)) {
    throw new WorkspaceConnectError(
      'invalid_response',
      'workspace-connect returned an invalid Gmail messages response',
    );
  }

  return record.messages.map((raw): GmailMessageSummary => {
    const message = asRecord(raw) ?? {};

    return {
      messageId: str(message.message_id),
      threadId: str(message.thread_id),
      sender: str(message.sender),
      recipients: strList(message.recipients),
      subject: str(message.subject),
      date: str(message.date),
      snippet: str(message.snippet),
      labelIds: strList(message.label_ids),
      isUnread: message.is_unread === true,
    };
  });
}

export function parseGmailThreadResponse(body: unknown): GmailThreadDetail {
  const record = asRecord(body);

  if (
    !record ||
    typeof record.thread_id !== 'string' ||
    !Array.isArray(record.messages)
  ) {
    throw new WorkspaceConnectError(
      'invalid_response',
      'workspace-connect returned an invalid Gmail thread response',
    );
  }

  const messages = record.messages.map((raw): GmailThreadMessage => {
    const message = asRecord(raw) ?? {};
    const attachments = Array.isArray(message.attachments)
      ? message.attachments.map((rawAttachment): GmailAttachmentMetadata => {
          const attachment = asRecord(rawAttachment) ?? {};

          return {
            attachmentId: optionalString(attachment.attachment_id),
            filename: optionalString(attachment.filename),
            mimeType: optionalString(attachment.mime_type),
            sizeBytes: optionalNumber(attachment.size_bytes),
          };
        })
      : [];

    return {
      messageId: str(message.message_id),
      sender: str(message.sender),
      recipients: strList(message.recipients),
      cc: strList(message.cc),
      subject: str(message.subject),
      date: str(message.date),
      plainTextBody: optionalString(message.plain_text_body),
      htmlBody: optionalString(message.html_body),
      attachments,
    };
  });

  return { threadId: record.thread_id, messages };
}

export function parseCalendarEventsResponse(
  body: unknown,
): CalendarEventsResult {
  const record = asRecord(body);

  if (!record || !Array.isArray(record.events)) {
    throw new WorkspaceConnectError(
      'invalid_response',
      'workspace-connect returned an invalid calendar events response',
    );
  }

  const events = record.events.map((raw): CalendarEvent => {
    const event = asRecord(raw) ?? {};

    return {
      eventId: str(event.event_id),
      calendarId: str(event.calendar_id),
      status: str(event.status),
      title: str(event.title),
      description: optionalString(event.description),
      location: optionalString(event.location),
      start: optionalString(event.start),
      end: optionalString(event.end),
      startDate: optionalString(event.start_date),
      endDate: optionalString(event.end_date),
      timeZone: optionalString(event.time_zone),
      allDay: event.all_day === true,
      htmlLink: optionalString(event.html_link),
    };
  });

  return {
    calendarId: str(record.calendar_id),
    events,
  };
}

export function parseGmailDraftResponse(body: unknown): GmailDraftDetail {
  const record = asRecord(body);

  if (!record || typeof record.draft_id !== 'string') {
    throw new WorkspaceConnectError(
      'invalid_response',
      'workspace-connect returned an invalid Gmail draft response',
    );
  }

  const to = strList(record.to);
  const recipients = strList(record.recipients);

  return {
    draftId: str(record.draft_id),
    messageId: str(record.message_id),
    threadId: str(record.thread_id),
    to: to.length > 0 ? to : recipients,
    cc: strList(record.cc),
    bcc: strList(record.bcc),
    subject: str(record.subject),
    plainTextBody: optionalString(record.plain_text_body),
    htmlBody: optionalString(record.html_body),
  };
}

export function parseCalendarEventResponse(body: unknown): CalendarEvent {
  const record = asRecord(body);

  if (!record || typeof record.event_id !== 'string') {
    throw new WorkspaceConnectError(
      'invalid_response',
      'workspace-connect returned an invalid calendar event response',
    );
  }

  return {
    eventId: str(record.event_id),
    calendarId: str(record.calendar_id),
    status: str(record.status),
    title: str(record.title),
    description: optionalString(record.description),
    location: optionalString(record.location),
    start: optionalString(record.start),
    end: optionalString(record.end),
    startDate: optionalString(record.start_date),
    endDate: optionalString(record.end_date),
    timeZone: optionalString(record.time_zone),
    allDay: record.all_day === true,
    htmlLink: optionalString(record.html_link),
  };
}

function toWriteError(
  response: Response,
  missingResource: 'not_connected' | 'not_found',
): WorkspaceConnectError {
  if (response.status === 400 || response.status === 422) {
    return new WorkspaceConnectError(
      'invalid',
      'workspace-connect rejected the request body',
    );
  }

  if (response.status === 401) {
    return new WorkspaceConnectError(
      'revoked',
      'Google connection is revoked or expired',
    );
  }

  if (response.status === 403) {
    return new WorkspaceConnectError(
      'forbidden',
      'Google denied access with the current permissions',
    );
  }

  if (response.status === 404) {
    return new WorkspaceConnectError(
      missingResource,
      'The requested Google resource was not found',
    );
  }

  if (response.status === 409) {
    return new WorkspaceConnectError('conflict', 'Idempotency key conflict');
  }

  if (response.status === 429) {
    return new WorkspaceConnectError(
      'unavailable',
      'Google rate limit reached',
    );
  }

  return new WorkspaceConnectError(
    'unavailable',
    `workspace-connect request failed with HTTP ${response.status}`,
  );
}

interface WriteRequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  payload?: unknown;
  idempotencyKey?: string;
  missingResource: 'not_connected' | 'not_found';
  returnBody: boolean;
}

async function writeWorkspaceConnect(
  config: WorkspaceConnectConfig,
  authenticatedUserId: string,
  options: WriteRequestOptions,
): Promise<unknown> {
  const token = createApiAccessToken(config, authenticatedUserId);

  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };

  if (options.idempotencyKey) {
    headers['idempotency-key'] = options.idempotencyKey;
  }

  const response = await workspaceConnectFetch(
    config,
    `${config.baseUrl}${options.path}`,
    {
      method: options.method,
      headers,
      body:
        options.payload !== undefined
          ? JSON.stringify(options.payload)
          : undefined,
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    throw toWriteError(response, options.missingResource);
  }

  if (!options.returnBody) {
    return null;
  }

  return response.json().catch(() => null);
}

function assertOpaqueId(id: string, label: string): void {
  if (!validateOpaqueId(id)) {
    throw new WorkspaceConnectError('forbidden', `${label} is invalid`);
  }
}

function gmailDraftCreatePayload(
  input: GmailDraftCreateInput,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    to: input.to,
    cc: input.cc ?? [],
    bcc: input.bcc ?? [],
    subject: input.subject,
  };

  if (input.plainTextBody !== undefined && input.plainTextBody !== null) {
    payload.plain_text_body = input.plainTextBody;
  }

  if (input.htmlBody !== undefined && input.htmlBody !== null) {
    payload.html_body = input.htmlBody;
  }

  if (input.replyToMessageId) {
    payload.reply_to_message_id = input.replyToMessageId;
  }

  if (input.threadId) {
    payload.thread_id = input.threadId;
  }

  return payload;
}

function gmailDraftUpdatePayload(
  input: GmailDraftUpdateInput,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (input.to !== undefined) payload.to = input.to;
  if (input.cc !== undefined) payload.cc = input.cc;
  if (input.bcc !== undefined) payload.bcc = input.bcc;
  if (input.subject !== undefined) payload.subject = input.subject;
  if (input.plainTextBody !== undefined) {
    payload.plain_text_body = input.plainTextBody;
  }
  if (input.htmlBody !== undefined) payload.html_body = input.htmlBody;

  return payload;
}

function calendarEventCreatePayload(
  input: CalendarEventCreateInput,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    calendar_id: 'primary',
    title: input.title,
  };

  if (input.description !== undefined && input.description !== null) {
    payload.description = input.description;
  }

  if (input.location !== undefined && input.location !== null) {
    payload.location = input.location;
  }

  if (input.kind === 'timed') {
    payload.start = input.start;
    payload.end = input.end;
    payload.time_zone = input.timeZone;
  } else {
    payload.start_date = input.startDate;
    payload.end_date = input.endDate;
  }

  return payload;
}

function calendarEventUpdatePayload(
  input: CalendarEventUpdateInput,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (input.title !== undefined) payload.title = input.title;
  if (input.description !== undefined) payload.description = input.description;
  if (input.location !== undefined) payload.location = input.location;
  if (input.start !== undefined) payload.start = input.start;
  if (input.end !== undefined) payload.end = input.end;
  if (input.timeZone !== undefined) payload.time_zone = input.timeZone;
  if (input.startDate !== undefined) payload.start_date = input.startDate;
  if (input.endDate !== undefined) payload.end_date = input.endDate;

  return payload;
}

export async function createGmailDraft(
  authenticatedUserId: string,
  input: GmailDraftCreateInput,
): Promise<GmailDraftDetail> {
  assertAuthenticatedUserId(authenticatedUserId);
  const config = getConfig();

  const body = await writeWorkspaceConnect(config, authenticatedUserId, {
    method: 'POST',
    path: '/gmail/drafts',
    payload: gmailDraftCreatePayload(input),
    missingResource: 'not_connected',
    returnBody: true,
  });

  return parseGmailDraftResponse(body);
}

export async function getGmailDraft(
  authenticatedUserId: string,
  draftId: string,
): Promise<GmailDraftDetail> {
  assertAuthenticatedUserId(authenticatedUserId);
  assertOpaqueId(draftId, 'draftId');
  const config = getConfig();

  const body = await writeWorkspaceConnect(config, authenticatedUserId, {
    method: 'GET',
    path: `/gmail/drafts/${encodeURIComponent(draftId)}`,
    missingResource: 'not_found',
    returnBody: true,
  });

  return parseGmailDraftResponse(body);
}

export async function updateGmailDraft(
  authenticatedUserId: string,
  draftId: string,
  input: GmailDraftUpdateInput,
): Promise<GmailDraftDetail> {
  assertAuthenticatedUserId(authenticatedUserId);
  assertOpaqueId(draftId, 'draftId');
  const config = getConfig();

  const body = await writeWorkspaceConnect(config, authenticatedUserId, {
    method: 'PATCH',
    path: `/gmail/drafts/${encodeURIComponent(draftId)}`,
    payload: gmailDraftUpdatePayload(input),
    missingResource: 'not_found',
    returnBody: true,
  });

  return parseGmailDraftResponse(body);
}

export async function deleteGmailDraft(
  authenticatedUserId: string,
  draftId: string,
): Promise<void> {
  assertAuthenticatedUserId(authenticatedUserId);
  assertOpaqueId(draftId, 'draftId');
  const config = getConfig();

  await writeWorkspaceConnect(config, authenticatedUserId, {
    method: 'DELETE',
    path: `/gmail/drafts/${encodeURIComponent(draftId)}`,
    missingResource: 'not_found',
    returnBody: false,
  });
}

export async function createCalendarEvent(
  authenticatedUserId: string,
  input: CalendarEventCreateInput,
  idempotencyKey: string,
): Promise<CalendarEvent> {
  assertAuthenticatedUserId(authenticatedUserId);
  const config = getConfig();

  const body = await writeWorkspaceConnect(config, authenticatedUserId, {
    method: 'POST',
    path: '/calendar/events',
    payload: calendarEventCreatePayload(input),
    idempotencyKey,
    missingResource: 'not_connected',
    returnBody: true,
  });

  return parseCalendarEventResponse(body);
}

export async function getCalendarEvent(
  authenticatedUserId: string,
  eventId: string,
): Promise<CalendarEvent> {
  assertAuthenticatedUserId(authenticatedUserId);
  assertOpaqueId(eventId, 'eventId');
  const config = getConfig();

  const body = await writeWorkspaceConnect(config, authenticatedUserId, {
    method: 'GET',
    path: `/calendar/events/${encodeURIComponent(eventId)}?calendar_id=primary`,
    missingResource: 'not_found',
    returnBody: true,
  });

  return parseCalendarEventResponse(body);
}

export async function updateCalendarEvent(
  authenticatedUserId: string,
  eventId: string,
  input: CalendarEventUpdateInput,
): Promise<CalendarEvent> {
  assertAuthenticatedUserId(authenticatedUserId);
  assertOpaqueId(eventId, 'eventId');
  const config = getConfig();

  const body = await writeWorkspaceConnect(config, authenticatedUserId, {
    method: 'PATCH',
    path: `/calendar/events/${encodeURIComponent(eventId)}?calendar_id=primary`,
    payload: calendarEventUpdatePayload(input),
    missingResource: 'not_found',
    returnBody: true,
  });

  return parseCalendarEventResponse(body);
}

export async function deleteCalendarEvent(
  authenticatedUserId: string,
  eventId: string,
): Promise<void> {
  assertAuthenticatedUserId(authenticatedUserId);
  assertOpaqueId(eventId, 'eventId');
  const config = getConfig();

  await writeWorkspaceConnect(config, authenticatedUserId, {
    method: 'DELETE',
    path: `/calendar/events/${encodeURIComponent(eventId)}?calendar_id=primary`,
    missingResource: 'not_found',
    returnBody: false,
  });
}

export async function getRecentGmailMessages(
  authenticatedUserId: string,
  options: GmailMessagesOptions = {},
): Promise<GmailMessageSummary[]> {
  assertAuthenticatedUserId(authenticatedUserId);
  const config = getConfig();

  const limit = normalizeLimit(
    options.limit,
    GMAIL_MESSAGES_LIMIT_DEFAULT,
    GMAIL_MESSAGES_LIMIT_MAX,
  );

  const searchParams = new URLSearchParams({ limit: String(limit) });
  if (options.query && options.query.length > 0) {
    searchParams.set('query', options.query);
  }

  const body = await fetchWorkspaceConnectData(
    config,
    authenticatedUserId,
    `/gmail/messages?${searchParams.toString()}`,
    'not_connected',
  );

  return parseGmailMessagesResponse(body);
}

export async function getGmailThread(
  authenticatedUserId: string,
  threadId: string,
): Promise<GmailThreadDetail> {
  assertAuthenticatedUserId(authenticatedUserId);

  if (!validateOpaqueId(threadId)) {
    throw new WorkspaceConnectError(
      'forbidden',
      'threadId is not a valid Gmail thread id',
    );
  }

  const config = getConfig();
  const encodedThreadId = encodeURIComponent(threadId);

  const body = await fetchWorkspaceConnectData(
    config,
    authenticatedUserId,
    `/gmail/threads/${encodedThreadId}`,
    'not_found',
  );

  return parseGmailThreadResponse(body);
}

export async function getUpcomingCalendarEvents(
  authenticatedUserId: string,
  options: UpcomingCalendarEventsOptions = {},
): Promise<CalendarEventsResult> {
  assertAuthenticatedUserId(authenticatedUserId);
  const config = getConfig();

  const days = normalizeLimit(
    options.days,
    CALENDAR_DAYS_DEFAULT,
    CALENDAR_DAYS_MAX,
  );
  const limit = normalizeLimit(
    options.limit,
    CALENDAR_EVENTS_LIMIT_DEFAULT,
    CALENDAR_EVENTS_LIMIT_MAX,
  );

  const now = Date.now();
  const timeMin = new Date(now).toISOString();
  const timeMax = new Date(now + days * 24 * 60 * 60 * 1000).toISOString();

  const searchParams = new URLSearchParams({
    calendar_id: 'primary',
    time_min: timeMin,
    time_max: timeMax,
    limit: String(limit),
  });

  const body = await fetchWorkspaceConnectData(
    config,
    authenticatedUserId,
    `/calendar/events?${searchParams.toString()}`,
    'not_connected',
  );

  return parseCalendarEventsResponse(body);
}
