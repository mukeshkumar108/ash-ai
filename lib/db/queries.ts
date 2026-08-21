import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';

import { and, asc, count, desc, eq, gt, gte, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import {
  user,
  chat,
  type User,
  document,
  type Suggestion,
  suggestion,
  message,
  vote,
  type DBMessage,
  type Chat,
  stream,
  generation,
  type RemixInputImage,
  type RemixState,
} from './schema';
import type { ArtifactKind } from '@/components/artifact';
import { generateUUID } from '../utils';
import { generateHashedPassword } from './utils';
import type { VisibilityType } from '@/components/visibility-selector';
import { ChatSDKError } from '../errors';
import type { StructuredMemory } from '@/lib/ai/summarizer';
import type { ActiveState } from '@/lib/ai/active-state';
import type {
  ContinuityEvent,
  RelationshipDynamics,
} from '@/lib/ai/continuity';
import { getDatabaseUrl } from './env';

// Optionally, if not using email/pass login, you can
// use the Drizzle adapter for Auth.js / NextAuth
// https://authjs.dev/reference/adapter/drizzle

type Database = ReturnType<typeof drizzle>;

let client: Sql | null = null;
let database: Database | null = null;
const queryContextStorage = new AsyncLocalStorage<{ routeName: string }>();

function getClient() {
  if (!client) {
    client = postgres(getDatabaseUrl());
  }

  return client;
}

function getDb() {
  if (!database) {
    database = drizzle(getClient());
  }

  return database;
}

export const db = new Proxy({} as Database, {
  get(_, property) {
    const target = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = target[property];

    return typeof value === 'function' ? value.bind(target) : value;
  },
}) as Database;

function logDatabaseError(operation: string, error: unknown) {
  console.error(`[db] ${operation} failed`, error);
}

function shouldLogQueryMetrics() {
  return (
    process.env.LOG_DB_TRANSFER === '1' ||
    process.env.NODE_ENV !== 'production' ||
    process.env.VERCEL_ENV === 'preview'
  );
}

function approximateJsonBytes(value: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
  } catch {
    return 0;
  }
}

function instrumentReadResult<T>(helperName: string, result: T): T {
  if (!shouldLogQueryMetrics()) {
    return result;
  }

  const routeName = queryContextStorage.getStore()?.routeName ?? 'unknown';
  const rowCount = Array.isArray(result)
    ? result.length
    : result == null
      ? 0
      : 1;
  const approxBytes = approximateJsonBytes(result);

  console.log(
    `[db-transfer] route=${routeName} helper=${helperName} rows=${rowCount} approx_json_bytes=${approxBytes}`,
  );

  return result;
}

export async function withQueryContext<T>(
  routeName: string,
  fn: () => Promise<T>,
) {
  return queryContextStorage.run({ routeName }, fn);
}

type CompatibleUserRow = {
  id: string;
  email: string;
  password: string | null;
  displayName: string | null;
  rpDisplayName: string | null;
  rpAge: string | null;
  rpLocation: string | null;
  rpOccupation: string | null;
  rpVibe: string | null;
  languagePreference: string | null;
  themePreference: string | null;
};

type CompatibleChatRow = {
  id: string;
  createdAt: Date;
  title: string;
  userId: string;
  characterId: string | null;
  visibility: 'public' | 'private' | null;
  memoryState: StructuredMemory | null;
  activeState: ActiveState | null;
  relationshipDynamics: RelationshipDynamics | null;
  continuityEvents: ContinuityEvent[] | null;
  continuitySeq: number | null;
  chatModel: string | null;
  sessionRouting: Record<string, unknown> | null;
};

type ChatAccessRow = {
  id: string;
  userId: string;
  visibility: 'public' | 'private' | null;
};

type ChatCursorRow = {
  id: string;
  createdAt: Date;
};

type ChatPageRow = {
  id: string;
  createdAt: Date;
  title: string;
  userId: string;
  characterId: string | null;
  visibility: 'public' | 'private' | null;
  chatModel: string | null;
};

type MessageRow = {
  id: string;
  chatId: string;
  role: string;
  parts: DBMessage['parts'];
  createdAt: Date;
};

type MessageCursorRow = {
  id: string;
  createdAt: Date;
};

export type ChatHistoryEntry = {
  id: string;
  createdAt: Date;
  title: string;
  visibility: 'public' | 'private';
};

export type ChatAccess = {
  id: string;
  userId: string;
  visibility: 'public' | 'private';
};

export type ChatPageData = {
  id: string;
  createdAt: Date;
  title: string;
  userId: string;
  characterId: string;
  visibility: 'public' | 'private';
  chatModel: string;
};

export type UserProfileRow = Omit<User, 'password'>;

export type MessagePage = {
  messages: DBMessage[];
  hasMore: boolean;
};

export type ConversationHandshakeContext = {
  chatsToday: number;
  lastInteractionAt: Date | null;
  lastInteractionText: string | null;
  totalUserTurns: number;
};

export async function getConversationHandshakeContext({
  userId,
  currentChatId,
  timeZone,
}: {
  userId: string;
  currentChatId: string;
  timeZone: string;
}): Promise<ConversationHandshakeContext> {
  try {
    const [row] = await getClient()<
      Array<{
        chatsToday: number;
        lastInteractionAt: Date | string | null;
        lastInteractionText: string | null;
        totalUserTurns: number;
      }>
    >`
      select
        count(distinct c.id) filter (
          where (
            c."createdAt" at time zone 'UTC' at time zone ${timeZone}
          )::date = (now() at time zone ${timeZone})::date
        )::int as "chatsToday",
        max(m."createdAt") filter (where c.id <> ${currentChatId}) as "lastInteractionAt",
        count(*) filter (where m.role = 'user')::int as "totalUserTurns",
        (
          select m2.parts::text
          from "Message_v2" m2
          inner join "Chat" c2 on c2.id = m2."chatId"
          where c2."userId" = ${userId} and c2.id <> ${currentChatId}
          order by m2."createdAt" desc
          limit 1
        ) as "lastInteractionText"
      from "Chat" c
      left join "Message_v2" m on m."chatId" = c.id
      where c."userId" = ${userId}
    `;

    const parsedLastInteractionAt = row?.lastInteractionAt
      ? new Date(row.lastInteractionAt)
      : null;

    return instrumentReadResult('getConversationHandshakeContext', {
      chatsToday: row?.chatsToday ?? 1,
      totalUserTurns: row?.totalUserTurns ?? 0,
      lastInteractionText: row?.lastInteractionText ?? null,
      lastInteractionAt:
        parsedLastInteractionAt &&
        !Number.isNaN(parsedLastInteractionAt.getTime())
          ? parsedLastInteractionAt
          : null,
    });
  } catch (error) {
    logDatabaseError('get conversation handshake context', error);
    return {
      chatsToday: 1,
      lastInteractionAt: null,
      lastInteractionText: null,
      totalUserTurns: 0,
    };
  }
}

function normalizeUserRow(row: CompatibleUserRow): User {
  return {
    id: row.id,
    email: row.email,
    password: row.password,
    displayName: row.displayName,
    rpDisplayName: row.rpDisplayName,
    rpAge: row.rpAge,
    rpLocation: row.rpLocation,
    rpOccupation: row.rpOccupation,
    rpVibe: row.rpVibe,
    languagePreference: row.languagePreference ?? 'en',
    themePreference: row.themePreference ?? 'system',
  };
}

function normalizeUserProfileRow(row: CompatibleUserRow): UserProfileRow {
  const normalizedUser = normalizeUserRow(row);
  const { password: _password, ...userProfile } = normalizedUser;

  return userProfile;
}

function normalizeChatRow(row: CompatibleChatRow): Chat {
  return {
    id: row.id,
    createdAt: row.createdAt,
    title: row.title,
    userId: row.userId,
    characterId: row.characterId ?? 'lila-harper',
    visibility: row.visibility ?? 'private',
    memoryState: row.memoryState,
    activeState: row.activeState,
    relationshipDynamics: row.relationshipDynamics,
    continuityEvents: row.continuityEvents,
    continuitySeq: row.continuitySeq ?? 0,
    chatModel: row.chatModel ?? 'chat-model',
    sessionRouting: row.sessionRouting,
  };
}

function normalizeChatAccessRow(row: ChatAccessRow): ChatAccess {
  return {
    id: row.id,
    userId: row.userId,
    visibility: row.visibility ?? 'private',
  };
}

function normalizeChatPageRow(row: ChatPageRow): ChatPageData {
  return {
    id: row.id,
    createdAt: row.createdAt,
    title: row.title,
    userId: row.userId,
    characterId: row.characterId ?? 'lila-harper',
    visibility: row.visibility ?? 'private',
    chatModel: row.chatModel ?? 'chat-model',
  };
}

function normalizeMessageRow(row: MessageRow): DBMessage {
  return {
    id: row.id,
    chatId: row.chatId,
    role: row.role,
    parts: row.parts,
    attachments: [],
    createdAt: row.createdAt,
  };
}

async function getMessageCursorById(id: string) {
  const [selectedMessage] = await getClient()<MessageCursorRow[]>`
    select
      m.id,
      m."createdAt"
    from "Message_v2" m
    where m.id = ${id}
    limit 1
  `;

  return selectedMessage ?? null;
}

export async function getUser(email: string): Promise<Array<User>> {
  try {
    const users = await getClient()<
      Array<Pick<CompatibleUserRow, 'id' | 'email' | 'password'>>
    >`
      select
        u.id,
        u.email,
        u.password
      from "User" u
      where u.email = ${email}
    `;

    return instrumentReadResult(
      'getUser',
      users.map((selectedUser) =>
        normalizeUserRow({
          ...selectedUser,
          displayName: null,
          rpDisplayName: null,
          rpAge: null,
          rpLocation: null,
          rpOccupation: null,
          rpVibe: null,
          languagePreference: 'en',
          themePreference: 'system',
        }),
      ),
    );
  } catch (error) {
    logDatabaseError('get user by email', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get user by email',
    );
  }
}

export async function getUserById(id: string): Promise<UserProfileRow | null> {
  try {
    const [selectedUser] = await getClient()<CompatibleUserRow[]>`
      select
        u.id,
        u.email,
        to_jsonb(u)->>'display_name' as "displayName",
        to_jsonb(u)->>'rp_display_name' as "rpDisplayName",
        to_jsonb(u)->>'rp_age' as "rpAge",
        to_jsonb(u)->>'rp_location' as "rpLocation",
        to_jsonb(u)->>'rp_occupation' as "rpOccupation",
        to_jsonb(u)->>'rp_vibe' as "rpVibe",
        coalesce(to_jsonb(u)->>'language_preference', 'en') as "languagePreference",
        coalesce(to_jsonb(u)->>'theme_preference', 'system') as "themePreference"
      from "User" u
      where u.id = ${id}
      limit 1
    `;

    return instrumentReadResult(
      'getUserById',
      selectedUser ? normalizeUserProfileRow(selectedUser) : null,
    );
  } catch (error) {
    logDatabaseError('get user by id', error);
    throw new ChatSDKError('bad_request:database', 'Failed to get user by id');
  }
}

export async function saveUserDefaultLocationIfMissing({
  userId,
  location,
}: {
  userId: string;
  location: string;
}): Promise<void> {
  const normalized = location.trim().slice(0, 120);
  if (!normalized) return;

  try {
    await getClient()`
      update "User"
      set "rp_location" = ${normalized}
      where id = ${userId}
        and nullif(trim(coalesce("rp_location", '')), '') is null
    `;
  } catch (error) {
    logDatabaseError('save user default location if missing', error);
  }
}

export async function createUser(email: string, password: string) {
  const hashedPassword = generateHashedPassword(password);

  try {
    return await db.insert(user).values({ email, password: hashedPassword });
  } catch (error) {
    logDatabaseError('create user', error);
    try {
      return await getClient()`
        insert into "User" (email, password)
        values (${email}, ${hashedPassword})
      `;
    } catch (fallbackError) {
      logDatabaseError('create user fallback', fallbackError);
      throw new ChatSDKError('bad_request:database', 'Failed to create user');
    }
  }
}

export async function createGuestUser() {
  const email = `guest-${Date.now()}`;
  const password = generateHashedPassword(generateUUID());

  try {
    return await db.insert(user).values({ email, password }).returning({
      id: user.id,
      email: user.email,
    });
  } catch (error) {
    logDatabaseError('create guest user', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to create guest user',
    );
  }
}

export async function saveChat({
  id,
  userId,
  title,
  characterId,
  visibility,
  chatModel,
}: {
  id: string;
  userId: string;
  title: string;
  characterId: string;
  visibility: VisibilityType;
  chatModel?: string;
}) {
  try {
    return await db.insert(chat).values({
      id,
      createdAt: new Date(),
      userId,
      title,
      characterId,
      visibility,
      chatModel: chatModel || 'chat-model',
    });
  } catch (error) {
    logDatabaseError('save chat', error);
    throw new ChatSDKError('bad_request:database', 'Failed to save chat');
  }
}

export async function updateChatModelById({
  id,
  chatModel,
}: {
  id: string;
  chatModel: string;
}) {
  try {
    return await db.update(chat).set({ chatModel }).where(eq(chat.id, id));
  } catch (error) {
    logDatabaseError('update chat model', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to update chat model',
    );
  }
}

export async function updateChatTitleById({
  id,
  userId,
  title,
}: {
  id: string;
  userId: string;
  title: string;
}) {
  try {
    return await db
      .update(chat)
      .set({ title })
      .where(and(eq(chat.id, id), eq(chat.userId, userId)));
  } catch (error) {
    logDatabaseError('update chat title', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to update chat title',
    );
  }
}

export async function updateChatSessionRouting({
  id,
  userId,
  sessionRouting,
}: {
  id: string;
  userId: string;
  sessionRouting: Record<string, unknown>;
}) {
  try {
    return await db
      .update(chat)
      .set({ sessionRouting })
      .where(and(eq(chat.id, id), eq(chat.userId, userId)));
  } catch (error) {
    logDatabaseError('update chat session routing', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to update chat session routing',
    );
  }
}

export async function getRecentChatByCharacter({
  userId,
  characterId,
}: {
  userId: string;
  characterId: string;
}) {
  try {
    const [selectedChat] = await db
      .select({
        id: chat.id,
        createdAt: chat.createdAt,
        title: chat.title,
        userId: chat.userId,
        characterId: chat.characterId,
        visibility: chat.visibility,
        chatModel: chat.chatModel,
      })
      .from(chat)
      .where(and(eq(chat.userId, userId), eq(chat.characterId, characterId)))
      .orderBy(desc(chat.createdAt))
      .limit(1);

    return instrumentReadResult(
      'getRecentChatByCharacter',
      selectedChat ? normalizeChatPageRow(selectedChat) : null,
    );
  } catch (error) {
    logDatabaseError('get recent chat by character', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get recent chat by character',
    );
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    await db.delete(vote).where(eq(vote.chatId, id));
    await db.delete(message).where(eq(message.chatId, id));
    await db.delete(stream).where(eq(stream.chatId, id));

    const [chatsDeleted] = await db
      .delete(chat)
      .where(eq(chat.id, id))
      .returning();
    return chatsDeleted;
  } catch (error) {
    logDatabaseError('delete chat by id', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to delete chat by id',
    );
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    const extendedLimit = limit + 1;

    let filteredChats: Array<ChatHistoryEntry> = [];

    if (startingAfter) {
      const selectedChat = await getChatCursorById({ id: startingAfter });

      if (!selectedChat) {
        throw new ChatSDKError(
          'not_found:database',
          `Chat with id ${startingAfter} not found`,
        );
      }

      const chats = await getClient()<ChatHistoryEntry[]>`
        select
          c.id,
          c."createdAt",
          c.title,
          coalesce(to_jsonb(c)->>'visibility', 'private') as "visibility"
        from "Chat" c
        where c."userId" = ${id}
          and c."createdAt" > ${selectedChat.createdAt}
        order by c."createdAt" desc
        limit ${extendedLimit}
      `;
      filteredChats = chats;
    } else if (endingBefore) {
      const selectedChat = await getChatCursorById({ id: endingBefore });

      if (!selectedChat) {
        throw new ChatSDKError(
          'not_found:database',
          `Chat with id ${endingBefore} not found`,
        );
      }

      const chats = await getClient()<ChatHistoryEntry[]>`
        select
          c.id,
          c."createdAt",
          c.title,
          coalesce(to_jsonb(c)->>'visibility', 'private') as "visibility"
        from "Chat" c
        where c."userId" = ${id}
          and c."createdAt" < ${selectedChat.createdAt}
        order by c."createdAt" desc
        limit ${extendedLimit}
      `;
      filteredChats = chats;
    } else {
      const chats = await getClient()<ChatHistoryEntry[]>`
        select
          c.id,
          c."createdAt",
          c.title,
          coalesce(to_jsonb(c)->>'visibility', 'private') as "visibility"
        from "Chat" c
        where c."userId" = ${id}
        order by c."createdAt" desc
        limit ${extendedLimit}
      `;
      filteredChats = chats;
    }

    const hasMore = filteredChats.length > limit;

    return instrumentReadResult('getChatsByUserId', {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    });
  } catch (error) {
    logDatabaseError('get chats by user id', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get chats by user id',
    );
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    const [selectedChat] = await getClient()<CompatibleChatRow[]>`
      select
        c.id,
        c."createdAt",
        c.title,
        c."userId",
        coalesce(to_jsonb(c)->>'characterId', 'lila-harper') as "characterId",
        coalesce(to_jsonb(c)->>'visibility', 'private') as "visibility",
        to_jsonb(c)->'memory_state' as "memoryState",
        to_jsonb(c)->'active_state' as "activeState",
        to_jsonb(c)->'relationship_dynamics' as "relationshipDynamics",
        to_jsonb(c)->'continuity_events' as "continuityEvents",
        coalesce(to_jsonb(c)->>'continuity_seq', '0')::int as "continuitySeq",
        coalesce(to_jsonb(c)->>'chatModel', 'chat-model') as "chatModel",
        to_jsonb(c)->'session_routing' as "sessionRouting"
      from "Chat" c
      where c.id = ${id}
      limit 1
    `;

    return instrumentReadResult(
      'getChatById',
      selectedChat ? normalizeChatRow(selectedChat) : null,
    );
  } catch (error) {
    logDatabaseError('get chat by id', error);
    throw new ChatSDKError('bad_request:database', 'Failed to get chat by id');
  }
}

export async function getChatAccessById({ id }: { id: string }) {
  try {
    const [selectedChat] = await getClient()<ChatAccessRow[]>`
      select
        c.id,
        c."userId",
        coalesce(to_jsonb(c)->>'visibility', 'private') as "visibility"
      from "Chat" c
      where c.id = ${id}
      limit 1
    `;

    return instrumentReadResult(
      'getChatAccessById',
      selectedChat ? normalizeChatAccessRow(selectedChat) : null,
    );
  } catch (error) {
    logDatabaseError('get chat access by id', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get chat access by id',
    );
  }
}

export async function getChatPageById({ id }: { id: string }) {
  try {
    const [selectedChat] = await getClient()<ChatPageRow[]>`
      select
        c.id,
        c."createdAt",
        c.title,
        c."userId",
        coalesce(to_jsonb(c)->>'characterId', 'lila-harper') as "characterId",
        coalesce(to_jsonb(c)->>'visibility', 'private') as "visibility",
        coalesce(to_jsonb(c)->>'chatModel', 'chat-model') as "chatModel"
      from "Chat" c
      where c.id = ${id}
      limit 1
    `;

    return instrumentReadResult(
      'getChatPageById',
      selectedChat ? normalizeChatPageRow(selectedChat) : null,
    );
  } catch (error) {
    logDatabaseError('get chat page by id', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get chat page by id',
    );
  }
}

export async function getChatCursorById({ id }: { id: string }) {
  try {
    const [selectedChat] = await getClient()<ChatCursorRow[]>`
      select
        c.id,
        c."createdAt"
      from "Chat" c
      where c.id = ${id}
      limit 1
    `;

    return instrumentReadResult('getChatCursorById', selectedChat ?? null);
  } catch (error) {
    logDatabaseError('get chat cursor by id', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get chat cursor by id',
    );
  }
}

export async function saveChatState({
  chatId,
  memoryState,
  activeState,
  relationshipDynamics,
  continuityEvents,
  continuityItems,
  relationshipDimensions,
  personModels,
  expectedContinuitySeq,
  nextContinuitySeq,
  refreshSeq,
}: {
  chatId: string;
  memoryState?: StructuredMemory | null;
  activeState?: ActiveState | null;
  relationshipDynamics?: RelationshipDynamics | null;
  continuityEvents?: ContinuityEvent[] | null;
  continuityItems?: any[] | null;
  relationshipDimensions?: Record<string, any> | null;
  personModels?: any[] | null;
  /** Optimistic-lock guard: only persist if the stored continuity_seq still equals this value. */
  expectedContinuitySeq?: number;
  /** If supplied together with expectedContinuitySeq, advance continuity_seq to this value. */
  nextContinuitySeq?: number;
  /** Mirrored into the v2 container for inspector observability. */
  refreshSeq?: number;
}) {
  try {
    const updateValues: Record<string, unknown> = {};

    if (memoryState !== undefined) {
      updateValues.memoryState = memoryState;
    }

    if (activeState !== undefined) {
      updateValues.activeState = activeState;
    }

    if (relationshipDynamics !== undefined) {
      updateValues.relationshipDynamics = relationshipDynamics;
    }

    // Only write one format to the continuityEvents column — never both
    const hasV2Data =
      continuityItems !== undefined || personModels !== undefined;

    if (continuityEvents !== undefined && !hasV2Data) {
      updateValues.continuityEvents = continuityEvents;
    }

    // Store ontology items and person models in a versioned wrapper within continuityEvents column
    if (hasV2Data) {
      const existing =
        updateValues.continuityEvents &&
        typeof updateValues.continuityEvents === 'object' &&
        !Array.isArray(updateValues.continuityEvents)
          ? (updateValues.continuityEvents as any)
          : { _v: '2', items: [], relationship: {} };
      updateValues.continuityEvents = {
        ...existing,
        _v: '2',
        items: continuityItems ?? existing.items ?? [],
        relationship: relationshipDimensions ?? existing.relationship ?? {},
        personModels: personModels ?? existing.personModels ?? [],
        events: continuityEvents ?? existing.events ?? [],
        refreshSeq: refreshSeq ?? existing.refreshSeq ?? 0,
      };
    }

    if (
      expectedContinuitySeq !== undefined &&
      nextContinuitySeq !== undefined
    ) {
      updateValues.continuitySeq = nextContinuitySeq;
    }

    if (Object.keys(updateValues).length === 0) {
      return { saved: false, stale: false, reason: 'no_fields' };
    }

    const conditions = [eq(chat.id, chatId)];
    if (expectedContinuitySeq !== undefined) {
      conditions.push(eq(chat.continuitySeq, expectedContinuitySeq));
    }

    try {
      const rows = await db
        .update(chat)
        .set(updateValues)
        .where(and(...conditions))
        .returning({ id: chat.id });

      if (expectedContinuitySeq !== undefined && rows.length === 0) {
        return { saved: false, stale: true, reason: 'sequence_conflict' };
      }

      return { saved: true, stale: false, reason: 'ok' };
    } catch (casError) {
      // The continuity_seq column does not exist yet (migration 0014 not
      // applied). Fall back to a plain write so the continuity pipeline keeps
      // working; the optimistic-lock guard resumes once the column exists.
      if (
        expectedContinuitySeq !== undefined &&
        String((casError as Error)?.message ?? '').includes('continuity_seq')
      ) {
        logDatabaseError(
          'save chat state (CAS unavailable — migration 0014 not applied?)',
          casError,
        );
        delete updateValues.continuitySeq;
        await db.update(chat).set(updateValues).where(eq(chat.id, chatId));
        return {
          saved: true,
          stale: false,
          reason: 'cas_unavailable_fallback',
        };
      }
      throw casError;
    }
  } catch (error) {
    logDatabaseError('save chat state', error);
    throw new ChatSDKError('bad_request:database', 'Failed to save chat state');
  }
}

export async function saveMessages({
  messages,
}: {
  messages: Array<DBMessage>;
}) {
  try {
    return await db.insert(message).values(messages);
  } catch (error) {
    logDatabaseError('save messages', error);
    throw new ChatSDKError('bad_request:database', 'Failed to save messages');
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    const messages = await getClient()<MessageRow[]>`
      select
        m.id,
        m."chatId",
        m.role,
        m.parts,
        m."createdAt"
      from "Message_v2" m
      where m."chatId" = ${id}
      order by m."createdAt" asc
    `;

    return instrumentReadResult(
      'getMessagesByChatId',
      messages.map(normalizeMessageRow),
    );
  } catch (error) {
    logDatabaseError('get messages by chat id', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get messages by chat id',
    );
  }
}

export async function getMessagePageByChatId({
  id,
  limit,
  before,
}: {
  id: string;
  limit: number;
  before?: string | null;
}): Promise<MessagePage> {
  try {
    const effectiveLimit = Math.max(1, Math.min(limit, 100));
    const extendedLimit = effectiveLimit + 1;

    let selectedMessages: MessageRow[];

    if (before) {
      const cursor = await getMessageCursorById(before);

      if (!cursor) {
        throw new ChatSDKError(
          'not_found:database',
          `Message with id ${before} not found`,
        );
      }

      selectedMessages = await getClient()<MessageRow[]>`
        select
          m.id,
          m."chatId",
          m.role,
          m.parts,
          m."createdAt"
        from "Message_v2" m
        where m."chatId" = ${id}
          and (
            m."createdAt" < ${cursor.createdAt}
            or (m."createdAt" = ${cursor.createdAt} and m.id < ${cursor.id})
          )
        order by m."createdAt" desc, m.id desc
        limit ${extendedLimit}
      `;
      selectedMessages.reverse();
    } else {
      selectedMessages = await getClient()<MessageRow[]>`
        select
          m.id,
          m."chatId",
          m.role,
          m.parts,
          m."createdAt"
        from "Message_v2" m
        where m."chatId" = ${id}
        order by m."createdAt" desc, m.id desc
        limit ${extendedLimit}
      `;
      selectedMessages.reverse();
    }

    const hasMore = selectedMessages.length > effectiveLimit;
    const pageMessages = hasMore
      ? selectedMessages.slice(selectedMessages.length - effectiveLimit)
      : selectedMessages;

    return instrumentReadResult('getMessagePageByChatId', {
      messages: pageMessages.map(normalizeMessageRow),
      hasMore,
    });
  } catch (error) {
    logDatabaseError('get message page by chat id', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get message page by chat id',
    );
  }
}

export async function getMostRecentMessageByChatId({ id }: { id: string }) {
  try {
    const [selectedMessage] = await getClient()<MessageRow[]>`
      select
        m.id,
        m."chatId",
        m.role,
        m.parts,
        m."createdAt"
      from "Message_v2" m
      where m."chatId" = ${id}
      order by m."createdAt" desc
      limit 1
    `;

    return instrumentReadResult(
      'getMostRecentMessageByChatId',
      selectedMessage ? normalizeMessageRow(selectedMessage) : null,
    );
  } catch (error) {
    logDatabaseError('get most recent message by chat id', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get most recent message by chat id',
    );
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: 'up' | 'down';
}) {
  try {
    const [existingVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.messageId, messageId)));

    if (existingVote) {
      return await db
        .update(vote)
        .set({ isUpvoted: type === 'up' })
        .where(and(eq(vote.messageId, messageId), eq(vote.chatId, chatId)));
    }
    return await db.insert(vote).values({
      chatId,
      messageId,
      isUpvoted: type === 'up',
    });
  } catch (error) {
    logDatabaseError('vote message', error);
    throw new ChatSDKError('bad_request:database', 'Failed to vote message');
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  try {
    const votesByChatId = await db
      .select({
        chatId: vote.chatId,
        messageId: vote.messageId,
        isUpvoted: vote.isUpvoted,
      })
      .from(vote)
      .where(eq(vote.chatId, id));

    return instrumentReadResult('getVotesByChatId', votesByChatId);
  } catch (error) {
    logDatabaseError('get votes by chat id', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get votes by chat id',
    );
  }
}

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}) {
  try {
    return await db
      .insert(document)
      .values({
        id,
        title,
        kind,
        content,
        userId,
        createdAt: new Date(),
      })
      .returning();
  } catch (error) {
    logDatabaseError('save document', error);
    throw new ChatSDKError('bad_request:database', 'Failed to save document');
  }
}

export async function getDocumentsById({ id }: { id: string }) {
  try {
    const documents = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(asc(document.createdAt));

    return documents;
  } catch (error) {
    logDatabaseError('get documents by id', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get documents by id',
    );
  }
}

export async function getDocumentById({ id }: { id: string }) {
  try {
    const [selectedDocument] = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt));

    return selectedDocument;
  } catch (error) {
    logDatabaseError('get document by id', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get document by id',
    );
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  try {
    await db
      .delete(suggestion)
      .where(
        and(
          eq(suggestion.documentId, id),
          gt(suggestion.documentCreatedAt, timestamp),
        ),
      );

    return await db
      .delete(document)
      .where(and(eq(document.id, id), gt(document.createdAt, timestamp)))
      .returning();
  } catch (error) {
    logDatabaseError('delete documents by id after timestamp', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to delete documents by id after timestamp',
    );
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Array<Suggestion>;
}) {
  try {
    return await db.insert(suggestion).values(suggestions);
  } catch (error) {
    logDatabaseError('save suggestions', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to save suggestions',
    );
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  try {
    return await db
      .select()
      .from(suggestion)
      .where(and(eq(suggestion.documentId, documentId)));
  } catch (error) {
    logDatabaseError('get suggestions by document id', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get suggestions by document id',
    );
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    const selectedMessages = await db
      .select({
        id: message.id,
        chatId: message.chatId,
        role: message.role,
        parts: message.parts,
        createdAt: message.createdAt,
      })
      .from(message)
      .where(eq(message.id, id));

    return instrumentReadResult(
      'getMessageById',
      selectedMessages.map(normalizeMessageRow),
    );
  } catch (error) {
    logDatabaseError('get message by id', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get message by id',
    );
  }
}

export async function updateMessageParts({
  id,
  parts,
}: {
  id: string;
  parts: any;
}) {
  try {
    return await db.update(message).set({ parts }).where(eq(message.id, id));
  } catch (error) {
    logDatabaseError('update message parts', error);
    throw new ChatSDKError('bad_request:database', 'Failed to update message');
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  try {
    const messagesToDelete = await db
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp)),
      );

    const messageIds = messagesToDelete.map((message) => message.id);

    if (messageIds.length > 0) {
      await db
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds)),
        );

      return await db
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds)),
        );
    }
  } catch (error) {
    logDatabaseError('delete messages by chat id after timestamp', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to delete messages by chat id after timestamp',
    );
  }
}

export async function updateChatVisiblityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: 'private' | 'public';
}) {
  try {
    return await db.update(chat).set({ visibility }).where(eq(chat.id, chatId));
  } catch (error) {
    logDatabaseError('update chat visibility by id', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to update chat visibility by id',
    );
  }
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: { id: string; differenceInHours: number }) {
  try {
    const twentyFourHoursAgo = new Date(
      Date.now() - differenceInHours * 60 * 60 * 1000,
    );

    const [stats] = await db
      .select({ count: count(message.id) })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(
        and(
          eq(chat.userId, id),
          gte(message.createdAt, twentyFourHoursAgo),
          eq(message.role, 'user'),
        ),
      )
      .execute();

    return stats?.count ?? 0;
  } catch (error) {
    logDatabaseError('get message count by user id', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get message count by user id',
    );
  }
}

export async function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  try {
    await db
      .insert(stream)
      .values({ id: streamId, chatId, createdAt: new Date() });
  } catch (error) {
    logDatabaseError('create stream id', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to create stream id',
    );
  }
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  try {
    const streamIds = await db
      .select({ id: stream.id })
      .from(stream)
      .where(eq(stream.chatId, chatId))
      .orderBy(asc(stream.createdAt))
      .execute();

    return streamIds.map(({ id }) => id);
  } catch (error) {
    logDatabaseError('get stream ids by chat id', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get stream ids by chat id',
    );
  }
}

export async function saveGeneration({
  userId,
  modelId,
  prompt,
  images,
  generationIndex = 1,
  parentOutputPathname = null,
  parentGenerationId = null,
  instruction = null,
  inputImages = null,
  remixState = null,
}: {
  userId: string;
  modelId: string;
  prompt: string;
  images: Array<{ url: string; pathname: string; mediaType: string }>;
  generationIndex?: number;
  parentOutputPathname?: string | null;
  parentGenerationId?: string | null;
  instruction?: string | null;
  inputImages?: RemixInputImage[] | null;
  remixState?: RemixState | null;
}) {
  try {
    return await db
      .insert(generation)
      .values({
        userId,
        modelId,
        prompt,
        images,
        generationIndex,
        parentOutputPathname,
        parentGenerationId,
        instruction,
        inputImages,
        remixState,
        createdAt: new Date(),
      })
      .returning({ id: generation.id });
  } catch (error) {
    logDatabaseError('save generation', error);
    throw new ChatSDKError('bad_request:database', 'Failed to save generation');
  }
}

export async function getGenerationsByUserId(userId: string) {
  try {
    return await db
      .select()
      .from(generation)
      .where(eq(generation.userId, userId))
      .orderBy(desc(generation.createdAt));
  } catch (error) {
    logDatabaseError('get generations by user id', error);
    throw new ChatSDKError('bad_request:database', 'Failed to get generations');
  }
}

export async function getVideoGenerationsByUserId(
  userId: string,
  modelIds: string[],
) {
  try {
    return await db
      .select()
      .from(generation)
      .where(
        and(eq(generation.userId, userId), inArray(generation.modelId, modelIds)),
      )
      .orderBy(desc(generation.createdAt));
  } catch (error) {
    logDatabaseError('get video generations by user id', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get video generations',
    );
  }
}

export async function getGenerationById({
  id,
  userId,
}: {
  id: string;
  userId: string;
}) {
  try {
    const rows = await db
      .select()
      .from(generation)
      .where(and(eq(generation.id, id), eq(generation.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    logDatabaseError('get generation by id', error);
    throw new ChatSDKError('bad_request:database', 'Failed to get generation');
  }
}

export async function deleteGenerationById({
  id,
  userId,
}: {
  id: string;
  userId: string;
}) {
  try {
    return await db
      .delete(generation)
      .where(and(eq(generation.id, id), eq(generation.userId, userId)));
  } catch (error) {
    logDatabaseError('delete generation', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to delete generation',
    );
  }
}
