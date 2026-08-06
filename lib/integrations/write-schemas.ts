import { z } from 'zod';

import {
  resolveCalendarEventCreate,
  resolveCalendarEventUpdate,
  validateGmailDraftCreate,
  validateGmailDraftUpdate,
  type CalendarEventCreateInput,
  type CalendarEventUpdateInput,
  type GmailDraftCreateInput,
  type GmailDraftUpdateInput,
} from '@/lib/integrations';

const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i;
const ALL_DAY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NO_CONTROL_PATTERN = /^[^\r\n]*$/;

export const emailField = z
  .string()
  .trim()
  .min(1, 'invalid_recipient')
  .max(254, 'invalid_recipient')
  .regex(EMAIL_PATTERN, 'invalid_recipient');
export const emailListField = z.array(emailField).max(20, 'invalid_recipient');

export const isoDatetimeField = z
  .string()
  .regex(RFC3339_PATTERN, 'invalid_datetime')
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'invalid_datetime',
  });

export const allDayDateField = z
  .string()
  .regex(ALL_DAY_DATE_PATTERN, 'invalid_date')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: 'invalid_date',
  });

export const draftSubjectField = z
  .string()
  .trim()
  .max(200, 'invalid_subject')
  .regex(NO_CONTROL_PATTERN, 'invalid_subject');
export const draftBodyField = z.string().max(50_000, 'invalid_body');
export const opaqueIdField = z
  .string()
  .trim()
  .min(1, 'invalid_thread_reference')
  .max(255, 'invalid_thread_reference')
  .regex(NO_CONTROL_PATTERN, 'invalid_thread_reference');

export const eventTitleField = z
  .string()
  .trim()
  .min(1, 'missing_event_title')
  .max(200, 'invalid_event_title');
export const eventLongTextField = (code: string, max: number) =>
  z.string().max(max, code).nullable().optional();
export const eventTimeZoneField = z
  .string()
  .trim()
  .min(1, 'invalid_time_zone')
  .max(64, 'invalid_time_zone');

const email = emailField;
const emailList = emailListField;
const isoDatetime = isoDatetimeField;
const allDayDate = allDayDateField;
const subject = draftSubjectField;
const body = draftBodyField;
const opaqueId = opaqueIdField;
const eventTitle = eventTitleField;
const eventLongText = eventLongTextField;
const timeZone = eventTimeZoneField;

export const gmailDraftCreateSchema = z
  .object({
    to: emailList.optional(),
    cc: emailList.optional(),
    bcc: emailList.optional(),
    subject: subject,
    plainTextBody: body.nullable().optional(),
    htmlBody: body.nullable().optional(),
    replyToMessageId: opaqueId.nullable().optional(),
    threadId: opaqueId.nullable().optional(),
  })
  .strict();

export const gmailDraftUpdateSchema = z
  .object({
    to: emailList.optional(),
    cc: emailList.optional(),
    bcc: emailList.optional(),
    subject: subject.optional(),
    plainTextBody: body.nullable().optional(),
    htmlBody: body.nullable().optional(),
  })
  .strict();

export const calendarEventCreateSchema = z
  .object({
    operationId: z
      .string({ required_error: 'invalid_operation_id' })
      .uuid('invalid_operation_id'),
    title: eventTitle,
    description: eventLongText('invalid_event_description', 2000),
    location: eventLongText('invalid_event_location', 500),
    start: isoDatetime.optional(),
    end: isoDatetime.optional(),
    timeZone: timeZone.optional(),
    startDate: allDayDate.optional(),
    endDate: allDayDate.optional(),
  })
  .strict();

export const calendarEventUpdateSchema = z
  .object({
    title: eventTitle.optional(),
    description: eventLongText('invalid_event_description', 2000),
    location: eventLongText('invalid_event_location', 500),
    start: isoDatetime.optional(),
    end: isoDatetime.optional(),
    timeZone: timeZone.optional(),
    startDate: allDayDate.optional(),
    endDate: allDayDate.optional(),
  })
  .strict();

const KNOWN_CODES = new Set([
  'invalid_recipient',
  'invalid_subject',
  'invalid_body',
  'invalid_datetime',
  'invalid_date',
  'invalid_time_zone',
  'invalid_operation_id',
  'invalid_thread_reference',
  'missing_event_title',
  'invalid_event_title',
  'invalid_event_description',
  'invalid_event_location',
]);

export type ParseOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; code: string };

function firstIssueCode(schema: z.ZodType<unknown>, input: unknown): string {
  const result = schema.safeParse(input);

  if (result.success) {
    return '';
  }

  const message = result.error.issues[0]?.message ?? 'invalid_request';
  return KNOWN_CODES.has(message) ? message : 'invalid_request';
}

export function parseGmailDraftCreateBody(
  input: unknown,
): ParseOutcome<GmailDraftCreateInput> {
  const result = gmailDraftCreateSchema.safeParse(input);

  if (!result.success) {
    const code = firstIssueCode(gmailDraftCreateSchema, input);
    return { ok: false, code };
  }

  const business = validateGmailDraftCreate(result.data);

  if (!business.ok) {
    return { ok: false, code: business.error };
  }

  return {
    ok: true,
    value: {
      to: result.data.to ?? [],
      cc: result.data.cc ?? [],
      bcc: result.data.bcc ?? [],
      subject: result.data.subject,
      plainTextBody: result.data.plainTextBody ?? null,
      htmlBody: result.data.htmlBody ?? null,
      replyToMessageId: result.data.replyToMessageId ?? null,
      threadId: result.data.threadId ?? null,
    },
  };
}

export function parseGmailDraftUpdateBody(
  input: unknown,
): ParseOutcome<GmailDraftUpdateInput> {
  const result = gmailDraftUpdateSchema.safeParse(input);

  if (!result.success) {
    const code = firstIssueCode(gmailDraftUpdateSchema, input);
    return { ok: false, code };
  }

  const business = validateGmailDraftUpdate(result.data);

  if (!business.ok) {
    return { ok: false, code: business.error };
  }

  const value: GmailDraftUpdateInput = {};
  if (result.data.to !== undefined) value.to = result.data.to;
  if (result.data.cc !== undefined) value.cc = result.data.cc;
  if (result.data.bcc !== undefined) value.bcc = result.data.bcc;
  if (result.data.subject !== undefined) value.subject = result.data.subject;
  if (result.data.plainTextBody !== undefined) {
    value.plainTextBody = result.data.plainTextBody;
  }
  if (result.data.htmlBody !== undefined) value.htmlBody = result.data.htmlBody;

  return { ok: true, value };
}

export type CalendarEventCreateParse = ParseOutcome<{
  operationId: string;
  input: CalendarEventCreateInput;
}>;

export function parseCalendarEventCreateBody(
  input: unknown,
): CalendarEventCreateParse {
  const result = calendarEventCreateSchema.safeParse(input);

  if (!result.success) {
    const code = firstIssueCode(calendarEventCreateSchema, input);
    return { ok: false, code };
  }

  const resolved = resolveCalendarEventCreate(result.data);

  if (!resolved.ok) {
    return { ok: false, code: resolved.error };
  }

  return {
    ok: true,
    value: {
      operationId: result.data.operationId,
      input: resolved.value,
    },
  };
}

export function parseCalendarEventUpdateBody(
  input: unknown,
): ParseOutcome<CalendarEventUpdateInput> {
  const result = calendarEventUpdateSchema.safeParse(input);

  if (!result.success) {
    const code = firstIssueCode(calendarEventUpdateSchema, input);
    return { ok: false, code };
  }

  const resolved = resolveCalendarEventUpdate(result.data);

  if (!resolved.ok) {
    return { ok: false, code: resolved.error };
  }

  const value: CalendarEventUpdateInput = {};
  if (result.data.title !== undefined) value.title = result.data.title;
  if (result.data.description !== undefined) {
    value.description = result.data.description;
  }
  if (result.data.location !== undefined) value.location = result.data.location;
  if (result.data.start !== undefined) value.start = result.data.start;
  if (result.data.end !== undefined) value.end = result.data.end;
  if (result.data.timeZone !== undefined) value.timeZone = result.data.timeZone;
  if (result.data.startDate !== undefined)
    value.startDate = result.data.startDate;
  if (result.data.endDate !== undefined) value.endDate = result.data.endDate;

  return { ok: true, value };
}
