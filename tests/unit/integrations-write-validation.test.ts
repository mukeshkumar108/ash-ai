import { test, expect } from '@playwright/test';

import {
  addCalendarDays,
  describeWriteError,
  extractEmailAddress,
  parseRecipientList,
  replySubject,
  resolveCalendarEventCreate,
  resolveCalendarEventUpdate,
  safeGoogleCalendarUrl,
  validateGmailDraftCreate,
  zonedDateTimeToIso,
} from '@/lib/integrations';
import {
  parseCalendarEventCreateBody,
  parseCalendarEventUpdateBody,
  parseGmailDraftCreateBody,
  parseGmailDraftUpdateBody,
} from '@/lib/integrations/write-schemas';

const validDraftCreate = {
  to: ['alice@example.com'],
  subject: 'Hello',
  plainTextBody: 'Body text',
};

const validTimedEvent = {
  operationId: '9f0c6f6e-0000-4000-8000-000000000000',
  title: 'Meeting',
  start: '2026-08-07T09:00:00+01:00',
  end: '2026-08-07T09:30:00+01:00',
  timeZone: 'Europe/London',
};

test('draft create requires at least one recipient', () => {
  const result = parseGmailDraftCreateBody({
    ...validDraftCreate,
    to: [],
  });

  expect(result).toEqual({ ok: false, code: 'no_recipient' });
});

test('draft create rejects invalid email addresses', () => {
  const result = parseGmailDraftCreateBody({
    ...validDraftCreate,
    to: ['not-an-email'],
  });

  expect(result).toEqual({ ok: false, code: 'invalid_recipient' });
});

test('draft create rejects CR/LF header injection in the subject', () => {
  const result = parseGmailDraftCreateBody({
    ...validDraftCreate,
    subject: 'Subject\r\nBcc: victim@example.com',
  });

  expect(result).toEqual({ ok: false, code: 'invalid_subject' });
});

test('draft create rejects an empty body', () => {
  const result = parseGmailDraftCreateBody({
    ...validDraftCreate,
    plainTextBody: '   ',
  });

  expect(result).toEqual({ ok: false, code: 'no_body' });
});

test('draft create trims whitespace and normalises missing fields', () => {
  const result = parseGmailDraftCreateBody({
    to: ['  alice@example.com  '],
    subject: '  Hello  ',
    plainTextBody: 'Body',
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.to).toEqual(['alice@example.com']);
    expect(result.value.subject).toBe('Hello');
    expect(result.value.cc).toEqual([]);
    expect(result.value.bcc).toEqual([]);
    expect(result.value.replyToMessageId).toBeNull();
    expect(result.value.threadId).toBeNull();
  }
});

test('draft create rejects unknown fields', () => {
  const result = parseGmailDraftCreateBody({
    ...validDraftCreate,
    sendNow: true,
  });

  expect(result).toEqual({ ok: false, code: 'invalid_request' });
});

test('draft update preserves omitted fields in request semantics', () => {
  const result = parseGmailDraftUpdateBody({ subject: 'Updated' });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toEqual({ subject: 'Updated' });
  }
});

test('draft update accepts an explicit null body as preserve', () => {
  const result = parseGmailDraftUpdateBody({ plainTextBody: null });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.plainTextBody).toBeNull();
  }
});

test('draft update rejects an empty provided body', () => {
  const result = parseGmailDraftUpdateBody({ plainTextBody: '  ' });

  expect(result).toEqual({ ok: false, code: 'no_body' });
});

test('timed calendar create resolves to a timed event on primary', () => {
  const result = parseCalendarEventCreateBody(validTimedEvent);

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.operationId).toBe(validTimedEvent.operationId);
    expect(result.value.input).toEqual({
      kind: 'timed',
      title: 'Meeting',
      description: null,
      location: null,
      start: '2026-08-07T09:00:00+01:00',
      end: '2026-08-07T09:30:00+01:00',
      timeZone: 'Europe/London',
    });
  }
});

test('all-day calendar create resolves to an all-day event', () => {
  const result = parseCalendarEventCreateBody({
    operationId: '9f0c6f6e-0000-4000-8000-000000000000',
    title: 'Holiday',
    startDate: '2026-08-10',
    endDate: '2026-08-11',
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.input).toEqual({
      kind: 'allDay',
      title: 'Holiday',
      description: null,
      location: null,
      startDate: '2026-08-10',
      endDate: '2026-08-11',
    });
  }
});

test('calendar create rejects equal all-day dates', () => {
  const result = parseCalendarEventCreateBody({
    operationId: '9f0c6f6e-0000-4000-8000-000000000000',
    title: 'Holiday',
    startDate: '2026-08-10',
    endDate: '2026-08-10',
  });

  expect(result).toEqual({ ok: false, code: 'invalid_date_range' });
});

test('calendar create rejects naive datetimes', () => {
  const result = parseCalendarEventCreateBody({
    ...validTimedEvent,
    start: '2026-08-07T09:00:00',
    end: '2026-08-07T09:30:00',
  });

  expect(result).toEqual({ ok: false, code: 'invalid_datetime' });
});

test('calendar create rejects mixed timed and all-day fields', () => {
  const result = parseCalendarEventCreateBody({
    ...validTimedEvent,
    startDate: '2026-08-10',
  });

  expect(result).toEqual({ ok: false, code: 'mixed_event_type' });
});

test('calendar create rejects start >= end', () => {
  const result = parseCalendarEventCreateBody({
    ...validTimedEvent,
    start: '2026-08-07T10:00:00+01:00',
    end: '2026-08-07T09:30:00+01:00',
  });

  expect(result).toEqual({ ok: false, code: 'invalid_time_range' });
});

test('calendar create rejects an all-day range with end before start', () => {
  const result = parseCalendarEventCreateBody({
    operationId: '9f0c6f6e-0000-4000-8000-000000000000',
    title: 'Holiday',
    startDate: '2026-08-10',
    endDate: '2026-08-09',
  });

  expect(result).toEqual({ ok: false, code: 'invalid_date_range' });
});

test('calendar create rejects missing event time', () => {
  const result = parseCalendarEventCreateBody({
    operationId: '9f0c6f6e-0000-4000-8000-000000000000',
    title: 'Meeting',
    timeZone: 'UTC',
  });

  expect(result).toEqual({ ok: false, code: 'missing_event_time' });
});

test('calendar create validates the operationId as a UUID', () => {
  const badUuid = parseCalendarEventCreateBody({
    ...validTimedEvent,
    operationId: 'not-a-uuid',
  });
  expect(badUuid).toEqual({ ok: false, code: 'invalid_operation_id' });

  const missing = parseCalendarEventCreateBody({
    ...validTimedEvent,
    operationId: undefined,
  });
  expect(missing).toEqual({ ok: false, code: 'invalid_operation_id' });
});

test('calendar create rejects unknown fields', () => {
  const result = parseCalendarEventCreateBody({
    ...validTimedEvent,
    attendees: [{ email: 'a@example.com' }],
  });

  expect(result).toEqual({ ok: false, code: 'invalid_request' });
});

test('calendar update validates partial updates and mixed fields', () => {
  const titleOnly = parseCalendarEventUpdateBody({ title: 'Renamed' });
  expect(titleOnly.ok).toBe(true);
  if (titleOnly.ok) {
    expect(titleOnly.value).toEqual({ title: 'Renamed' });
  }

  const mixed = parseCalendarEventUpdateBody({
    start: '2026-08-07T09:00:00Z',
    startDate: '2026-08-10',
  });
  expect(mixed).toEqual({ ok: false, code: 'mixed_event_type' });

  const missingEnd = parseCalendarEventUpdateBody({
    start: '2026-08-07T09:00:00Z',
  });
  expect(missingEnd).toEqual({ ok: false, code: 'missing_event_time' });
});

test('pure resolvers reject invalid time ranges', () => {
  expect(
    resolveCalendarEventCreate({
      title: 't',
      start: '2026-08-07T10:00:00Z',
      end: '2026-08-07T09:00:00Z',
      timeZone: 'UTC',
    }),
  ).toEqual({ ok: false, error: 'invalid_time_range' });

  expect(
    resolveCalendarEventUpdate({
      startDate: '2026-08-10',
      endDate: '2026-08-09',
    }),
  ).toEqual({ ok: false, error: 'invalid_date_range' });

  expect(
    resolveCalendarEventUpdate({
      startDate: '2026-08-10',
      endDate: '2026-08-10',
    }),
  ).toEqual({ ok: false, error: 'invalid_date_range' });
});

test('pure draft validators enforce recipient and body rules', () => {
  expect(validateGmailDraftCreate({ to: [], plainTextBody: 'x' })).toEqual({
    ok: false,
    error: 'no_recipient',
  });
  expect(
    validateGmailDraftCreate({ to: ['a@example.com'], plainTextBody: '' }),
  ).toEqual({ ok: false, error: 'no_body' });
  expect(
    validateGmailDraftCreate({ to: ['a@example.com'], plainTextBody: 'x' }),
  ).toEqual({ ok: true });
});

test('zonedDateTimeToIso converts wall time in a timezone to an RFC3339 instant', () => {
  expect(zonedDateTimeToIso('2026-08-07', '09:00', 'Europe/London')).toBe(
    '2026-08-07T08:00:00.000Z',
  );
  expect(zonedDateTimeToIso('2026-01-07', '09:00', 'Europe/London')).toBe(
    '2026-01-07T09:00:00.000Z',
  );
  expect(zonedDateTimeToIso('2026-08-07', '09:00', 'Not/AZone')).toBe('');
  expect(zonedDateTimeToIso('not-a-date', '09:00', 'UTC')).toBe('');
});

test('addCalendarDays operates on ISO calendar dates independently of timezone', () => {
  expect(addCalendarDays('2026-08-10', 1)).toBe('2026-08-11');
  expect(addCalendarDays('2026-01-31', 1)).toBe('2026-02-01');
  expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
  expect(addCalendarDays('2024-02-28', 1)).toBe('2024-02-29');
  expect(addCalendarDays('2026-02-28', 1)).toBe('2026-03-01');
  expect(addCalendarDays('2026-08-10', 5)).toBe('2026-08-15');
  expect(addCalendarDays('not-a-date', 1)).toBe('');
  expect(addCalendarDays('2026-08-10', 1.5)).toBe('');
});

test('safeGoogleCalendarUrl only accepts known Google Calendar event links', () => {
  const accepted = [
    'https://www.google.com/calendar/event?eid=abc',
    'https://calendar.google.com/calendar/event?eid=abc',
    'https://calendar.google.com/event?id=1',
  ];

  for (const url of accepted) {
    expect(safeGoogleCalendarUrl(url)).toBe(url);
  }

  const rejected = [
    null,
    'http://www.google.com/calendar/event?eid=abc',
    'https://www.google.com/',
    'https://www.google.com/search?q=calendar',
    'https://www.google.com/calendar/event-notes?eid=abc',
    'https://google.com/calendar/event?eid=abc',
    'https://evil.example/calendar/event?eid=abc',
    'https://calendar.google.com/',
    'https://not-a-url',
  ];

  for (const url of rejected) {
    expect(safeGoogleCalendarUrl(url)).toBeNull();
  }
});

test('recipient and reply helpers extract safe values', () => {
  expect(extractEmailAddress('Alice <alice@example.com>')).toBe(
    'alice@example.com',
  );
  expect(extractEmailAddress('alice@example.com')).toBe('alice@example.com');
  expect(extractEmailAddress('no email here')).toBeNull();
  expect(replySubject('Hello')).toBe('Re: Hello');
  expect(replySubject('Re: Hello')).toBe('Re: Hello');
  expect(parseRecipientList(' a@example.com , b@example.com ')).toEqual([
    'a@example.com',
    'b@example.com',
  ]);
});

test('describeWriteError covers the validation codes surfaced to the UI', () => {
  expect(describeWriteError('invalid_recipient')).toContain('recipient');
  expect(describeWriteError('no_body')).toContain('body');
  expect(describeWriteError('invalid_time_range')).toContain('before');
  expect(describeWriteError('unknown-code')).toContain('invalid values');
});
