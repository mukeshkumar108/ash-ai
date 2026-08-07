import 'server-only';

import { createDeepAgent } from 'deepagents';
import { tool } from '@langchain/core/tools';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { z } from 'zod';

import { AISDKChatModel } from '@/lib/agent/ai-sdk-chat-model';
import {
  buildBraveResearchTools,
  createResearchSession,
  type ResearchSession,
} from '@/lib/agent/brave-search';
import { buildAshAgentSystemPrompt } from '@/lib/agent/system-prompt';
import { buildTinyFishFetchTool } from '@/lib/agent/tinyfish-fetch';
import { getLanguageModel, getPinnedOpenAIModel } from '@/lib/ai/providers';
import {
  describeIntegrationFailure,
  describeWriteError,
  extractPlainTextFromHtml,
  integrationFailureReason,
  resolveCalendarEventCreate,
  validateOpaqueId,
  type CalendarEvent,
} from '@/lib/integrations';
import {
  allDayDateField,
  draftBodyField,
  draftSubjectField,
  emailListField,
  eventLongTextField,
  eventTimeZoneField,
  isoDatetimeField,
  opaqueIdField,
  parseCalendarEventUpdateBody,
  parseGmailDraftCreateBody,
  parseGmailDraftUpdateBody,
} from '@/lib/integrations/write-schemas';
import {
  createCalendarEvent,
  createGmailDraft,
  deleteCalendarEvent,
  deleteGmailDraft,
  getCalendarEvent,
  getGmailThread,
  getRecentGmailMessages,
  getUpcomingCalendarEvents,
  updateCalendarEvent,
  updateGmailDraft,
  WorkspaceConnectError,
} from '@/lib/workspace-connect';
import { generateUUID } from '@/lib/utils';

const CHAT_MAX_OUTPUT_TOKENS = Number(
  process.env.CHAT_MAX_OUTPUT_TOKENS ?? 1200,
);
const RESEARCH_CHAT_MAX_OUTPUT_TOKENS = Number(
  process.env.RESEARCH_CHAT_MAX_OUTPUT_TOKENS ?? 3200,
);

export function outputTokenBudget(researchDepth?: 'none' | 'light' | 'deep') {
  return researchDepth && researchDepth !== 'none'
    ? RESEARCH_CHAT_MAX_OUTPUT_TOKENS
    : CHAT_MAX_OUTPUT_TOKENS;
}

function isPinnedOpenAIResearchModel(modelId: string): boolean {
  return (
    modelId === 'openai/gpt-5.6-luna-pro' || modelId === 'openai/gpt-5.6-luna'
  );
}

// Chat does not yet have a durable approve-and-resume protocol. Keep the
// deterministic write implementations available to the settings UI, but do
// not expose mutating tools to the model until an exact payload can be shown to
// and approved by the user before execution.
const MODEL_BLOCKED_WRITE_TOOLS = new Set([
  'gmail_create_draft',
  'gmail_update_draft',
  'gmail_delete_draft',
  'calendar_create_event',
  'calendar_update_event',
  'calendar_delete_event',
]);
const LANGSMITH_TRACING_ENV_VARS = [
  'LANGSMITH_TRACING_V2',
  'LANGCHAIN_TRACING_V2',
  'LANGSMITH_TRACING',
  'LANGCHAIN_TRACING',
] as const;

export function assertPrivateTracingPolicy(): void {
  const tracingRequested = LANGSMITH_TRACING_ENV_VARS.some(
    (name) => process.env[name]?.toLowerCase() === 'true',
  );

  if (
    tracingRequested &&
    process.env.ASH_ALLOW_PRIVATE_LANGSMITH_TRACING !== 'true'
  ) {
    throw new Error(
      'LangSmith tracing is disabled for private Ash chat data unless explicitly allowed',
    );
  }
}

function safeToolError(error: unknown): string {
  if (error instanceof WorkspaceConnectError) {
    return describeIntegrationFailure(integrationFailureReason(error.code));
  }

  return 'Something went wrong reaching your Google connection.';
}

const calendarCreateInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: eventLongTextField('invalid_event_description', 2000),
    location: eventLongTextField('invalid_event_location', 500),
    start: isoDatetimeField.optional(),
    end: isoDatetimeField.optional(),
    timeZone: eventTimeZoneField.optional(),
    startDate: allDayDateField.optional(),
    endDate: allDayDateField.optional(),
  })
  .strict();

const calendarUpdateInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: eventLongTextField('invalid_event_description', 2000),
    location: eventLongTextField('invalid_event_location', 500),
    start: isoDatetimeField.optional(),
    end: isoDatetimeField.optional(),
    timeZone: eventTimeZoneField.optional(),
    startDate: allDayDateField.optional(),
    endDate: allDayDateField.optional(),
  })
  .strict();

function compactEvent(event: CalendarEvent) {
  return {
    eventId: event.eventId,
    title: event.title,
    description: event.description,
    location: event.location,
    start: event.start,
    end: event.end,
    startDate: event.startDate,
    endDate: event.endDate,
    timeZone: event.timeZone,
    allDay: event.allDay,
    status: event.status,
  };
}

export function buildAshAgentTools(
  userId: string,
  temporalContext: {
    now?: Date;
    timeZone?: string;
  } = {},
) {
  const now = temporalContext.now ?? new Date();
  const timeZone = temporalContext.timeZone ?? 'Europe/London';
  const tools = [
    tool(
      async ({ limit, query }: { limit?: number; query?: string }) => {
        try {
          const messages = await getRecentGmailMessages(userId, {
            limit,
            query,
          });
          return { messages };
        } catch (error) {
          return { error: safeToolError(error) };
        }
      },
      {
        name: 'gmail_list_messages',
        description:
          'List the signed-in user\'s recent Gmail messages. Accepts Gmail search syntax such as "is:unread", "newer_than:7d", or "from:name@example.com". Defaults to 10 messages; limit is 1 to 20; query is at most 256 characters.',
        schema: z.object({
          limit: z.number().int().min(1).max(20).optional(),
          query: z.string().max(256).optional(),
        }),
      },
    ),

    tool(
      async ({ threadId }: { threadId: string }) => {
        if (!validateOpaqueId(threadId)) {
          return { error: 'That is not a valid email thread ID.' };
        }

        try {
          const thread = await getGmailThread(userId, threadId);
          return {
            threadId: thread.threadId,
            messages: thread.messages.map((message) => ({
              messageId: message.messageId,
              sender: message.sender,
              recipients: message.recipients,
              cc: message.cc,
              subject: message.subject,
              date: message.date,
              plainTextBody: message.plainTextBody?.trim()
                ? message.plainTextBody
                : message.htmlBody
                  ? extractPlainTextFromHtml(message.htmlBody)
                  : '',
              attachments: message.attachments.map((attachment) => ({
                attachmentId: attachment.attachmentId,
                filename: attachment.filename,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
              })),
            })),
          };
        } catch (error) {
          return { error: safeToolError(error) };
        }
      },
      {
        name: 'gmail_read_thread',
        description:
          'Read a full Gmail thread by its opaque thread ID. Returns the messages in thread order with sender, recipients, subject, date, plain-text body, and attachment metadata.',
        schema: z.object({
          threadId: z.string().min(1).max(255),
        }),
      },
    ),

    tool(
      async (args: Record<string, unknown>) => {
        const parsed = parseGmailDraftCreateBody(args);

        if (!parsed.ok) {
          return { error: describeWriteError(parsed.code) };
        }

        try {
          const draft = await createGmailDraft(userId, parsed.value);
          return {
            draftId: draft.draftId,
            messageId: draft.messageId,
            threadId: draft.threadId,
            to: draft.to,
            subject: draft.subject,
            status: 'saved',
          };
        } catch (error) {
          return { error: safeToolError(error) };
        }
      },
      {
        name: 'gmail_create_draft',
        description:
          'Create a new Gmail draft for the signed-in user. Provide at least one recipient (to, cc, or bcc) and a plain-text body. To create a reply draft, include the original message ID as replyToMessageId and its thread ID as threadId from a thread you have read. Drafts are saved but never sent.',
        schema: z
          .object({
            to: emailListField.optional(),
            cc: emailListField.optional(),
            bcc: emailListField.optional(),
            subject: draftSubjectField,
            plainTextBody: draftBodyField.nullable().optional(),
            htmlBody: draftBodyField.nullable().optional(),
            replyToMessageId: opaqueIdField.nullable().optional(),
            threadId: opaqueIdField.nullable().optional(),
          })
          .strict(),
      },
    ),

    tool(
      async (args: Record<string, unknown>) => {
        const draftId = typeof args.draftId === 'string' ? args.draftId : '';

        if (!validateOpaqueId(draftId)) {
          return { error: 'That is not a valid draft ID.' };
        }

        const { draftId: _draftId, ...updateFields } = args;
        const parsed = parseGmailDraftUpdateBody(updateFields);

        if (!parsed.ok) {
          return { error: describeWriteError(parsed.code) };
        }

        try {
          const draft = await updateGmailDraft(userId, draftId, parsed.value);
          return {
            draftId: draft.draftId,
            messageId: draft.messageId,
            threadId: draft.threadId,
            to: draft.to,
            subject: draft.subject,
            status: 'updated',
          };
        } catch (error) {
          return { error: safeToolError(error) };
        }
      },
      {
        name: 'gmail_update_draft',
        description:
          'Update an existing Gmail draft by its opaque draft ID. Any provided field is replaced; omitted fields are preserved.',
        schema: z
          .object({
            draftId: opaqueIdField,
            to: emailListField.optional(),
            cc: emailListField.optional(),
            bcc: emailListField.optional(),
            subject: draftSubjectField.optional(),
            plainTextBody: draftBodyField.nullable().optional(),
            htmlBody: draftBodyField.nullable().optional(),
          })
          .strict(),
      },
    ),

    tool(
      async ({ draftId }: { draftId: string }) => {
        if (!validateOpaqueId(draftId)) {
          return { error: 'That is not a valid draft ID.' };
        }

        try {
          await deleteGmailDraft(userId, draftId);
          return { draftId, status: 'deleted' };
        } catch (error) {
          return { error: safeToolError(error) };
        }
      },
      {
        name: 'gmail_delete_draft',
        description:
          'Delete an existing Gmail draft by its opaque draft ID. The draft is permanently removed.',
        schema: z.object({
          draftId: z.string().min(1).max(255),
        }),
      },
    ),

    tool(
      async ({ days }: { days?: number }) => {
        try {
          const result = await getUpcomingCalendarEvents(userId, { days });
          const effectiveDays = days ?? 7;
          return {
            currentLocalDate: new Intl.DateTimeFormat('en-CA', {
              timeZone,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).format(now),
            timeZone,
            queryRange: {
              startsAt: now.toISOString(),
              endsAt: new Date(
                now.getTime() + effectiveDays * 24 * 60 * 60 * 1_000,
              ).toISOString(),
            },
            events: result.events,
          };
        } catch (error) {
          return { error: safeToolError(error) };
        }
      },
      {
        name: 'calendar_list_events',
        description:
          "List upcoming events on the signed-in user's primary calendar. Defaults to the next 7 days; days is 1 to 30.",
        schema: z.object({
          days: z.number().int().min(1).max(30).optional(),
        }),
      },
    ),

    tool(
      async ({ eventId }: { eventId: string }) => {
        if (!validateOpaqueId(eventId)) {
          return { error: 'That is not a valid calendar event ID.' };
        }

        try {
          const event = await getCalendarEvent(userId, eventId);
          return compactEvent(event);
        } catch (error) {
          return { error: safeToolError(error) };
        }
      },
      {
        name: 'calendar_get_event',
        description:
          "Get a single calendar event by its opaque event ID on the signed-in user's primary calendar.",
        schema: z.object({
          eventId: z.string().min(1).max(255),
        }),
      },
    ),

    tool(
      async (args: Record<string, unknown>) => {
        const resolved = resolveCalendarEventCreate(
          args as {
            title: string;
            description?: string | null;
            location?: string | null;
            start?: string;
            end?: string;
            timeZone?: string;
            startDate?: string;
            endDate?: string;
          },
        );

        if (!resolved.ok) {
          return { error: describeWriteError(resolved.error) };
        }

        try {
          const event = await createCalendarEvent(
            userId,
            resolved.value,
            generateUUID(),
          );
          return compactEvent(event);
        } catch (error) {
          return { error: safeToolError(error) };
        }
      },
      {
        name: 'calendar_create_event',
        description:
          "Create a new event on the signed-in user's primary calendar. For a timed event provide start, end, and timeZone as RFC 3339 strings. For an all-day event provide startDate and endDate as YYYY-MM-DD; the end date is exclusive, so a one-day event on a date ends the next day.",
        schema: calendarCreateInputSchema,
      },
    ),

    tool(
      async (args: Record<string, unknown>) => {
        const eventId = typeof args.eventId === 'string' ? args.eventId : '';

        if (!validateOpaqueId(eventId)) {
          return { error: 'That is not a valid calendar event ID.' };
        }

        const { eventId: _eventId, ...updateFields } = args;
        const parsed = parseCalendarEventUpdateBody(updateFields);

        if (!parsed.ok) {
          return { error: describeWriteError(parsed.code) };
        }

        try {
          const event = await updateCalendarEvent(
            userId,
            eventId,
            parsed.value,
          );
          return compactEvent(event);
        } catch (error) {
          return { error: safeToolError(error) };
        }
      },
      {
        name: 'calendar_update_event',
        description:
          "Update an existing calendar event by its opaque event ID on the signed-in user's primary calendar. Omitted fields are preserved. You cannot change which calendar an event is on.",
        schema: z
          .object({
            eventId: opaqueIdField,
            title: z.string().trim().min(1).max(200).optional(),
            description: eventLongTextField('invalid_event_description', 2000),
            location: eventLongTextField('invalid_event_location', 500),
            start: isoDatetimeField.optional(),
            end: isoDatetimeField.optional(),
            timeZone: eventTimeZoneField.optional(),
            startDate: allDayDateField.optional(),
            endDate: allDayDateField.optional(),
          })
          .strict(),
      },
    ),

    tool(
      async ({ eventId }: { eventId: string }) => {
        if (!validateOpaqueId(eventId)) {
          return { error: 'That is not a valid calendar event ID.' };
        }

        try {
          await deleteCalendarEvent(userId, eventId);
          return { eventId, status: 'deleted' };
        } catch (error) {
          return { error: safeToolError(error) };
        }
      },
      {
        name: 'calendar_delete_event',
        description:
          "Delete an existing calendar event by its opaque event ID on the signed-in user's primary calendar.",
        schema: z.object({
          eventId: z.string().min(1).max(255),
        }),
      },
    ),
  ];

  return tools;
}

export function buildAshModelTools(
  userId: string,
  temporalContext: { now?: Date; timeZone?: string } = {},
  researchSession: ResearchSession = createResearchSession(),
) {
  const canonicalUrl = (url: URL | string) => {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  };

  return [
    ...buildAshAgentTools(userId, temporalContext).filter(
      (candidate) => !MODEL_BLOCKED_WRITE_TOOLS.has(candidate.name),
    ),
    ...buildBraveResearchTools({
      session: researchSession,
      onDiscoveredUrl: (url) =>
        researchSession.discoveredUrls.add(canonicalUrl(url)),
    }),
    buildTinyFishFetchTool({
      isUrlAllowed: (url) =>
        researchSession.discoveredUrls.has(canonicalUrl(url)),
    }),
  ];
}

export function createAshAgent({
  userId,
  modelId,
  model,
  now = new Date(),
  timeZone = process.env.ASH_TIME_ZONE?.trim() || 'Europe/London',
  researchRequirement,
  researchSession,
}: {
  userId: string;
  modelId: string;
  model?: BaseChatModel;
  now?: Date;
  timeZone?: string;
  researchRequirement?: {
    reason: string;
    retry: boolean;
    researchDepth?: 'none' | 'light' | 'deep';
    freshnessNeed?: 'none' | 'preferred' | 'required';
    authorityNeed?: 'none' | 'preferred' | 'required';
    sourceSensitivity?: 'low' | 'medium' | 'high';
    neutralResearchQuestion?: string | null;
    userDeclinedResearch?: boolean;
    missing?: string[];
  };
  researchSession?: ResearchSession;
}) {
  assertPrivateTracingPolicy();

  const chatModel =
    model ??
    new AISDKChatModel(
      (isPinnedOpenAIResearchModel(modelId)
        ? getPinnedOpenAIModel(modelId)
        : getLanguageModel(modelId)) as never,
      {
        ...(isPinnedOpenAIResearchModel(modelId) ? {} : { temperature: 0.85 }),
        maxOutputTokens: outputTokenBudget(researchRequirement?.researchDepth),
      },
    );

  return createDeepAgent({
    model: chatModel as BaseChatModel,
    systemPrompt: buildAshAgentSystemPrompt({
      now,
      timeZone,
      researchRequirement,
    }),
    tools: buildAshModelTools(
      userId,
      { now, timeZone },
      researchSession ?? createResearchSession(),
    ),
  });
}
