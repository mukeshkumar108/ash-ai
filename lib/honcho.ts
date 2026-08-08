import 'server-only';

import { Honcho, type Message } from '@honcho-ai/sdk';

const DEFAULT_WORKSPACE_ID = 'llm-test-agent';
const SOPHIE_PEER_ID = 'sophie';

let client: Honcho | null = null;

export function honchoIds(userId: string, chatId: string) {
  return {
    workspaceId:
      process.env.HONCHO_WORKSPACE_ID?.trim() || DEFAULT_WORKSPACE_ID,
    userPeerId: `user_${userId}`,
    sophiePeerId: SOPHIE_PEER_ID,
    sessionId: `chat_${chatId}`,
  };
}

export function isHonchoConfigured() {
  return Boolean(process.env.HONCHO_URL?.trim());
}

function getHoncho() {
  const baseURL = process.env.HONCHO_URL?.trim();
  if (!baseURL) return null;
  if (!client) {
    client = new Honcho({
      baseURL,
      workspaceId:
        process.env.HONCHO_WORKSPACE_ID?.trim() || DEFAULT_WORKSPACE_ID,
      apiKey: process.env.HONCHO_API_KEY?.trim() || undefined,
      timeout: Number(process.env.HONCHO_TIMEOUT_MS ?? 5_000),
      maxRetries: 1,
    });
  }
  return client;
}

async function mappedEntities(userId: string, chatId: string) {
  const honcho = getHoncho();
  if (!honcho) throw new Error('HONCHO_URL is not configured');
  const ids = honchoIds(userId, chatId);
  const [userPeer, sophiePeer] = await Promise.all([
    honcho.peer(ids.userPeerId),
    honcho.peer(ids.sophiePeerId),
  ]);
  const session = await honcho.session(ids.sessionId, {
    peers: [userPeer, sophiePeer],
  });
  return { honcho, ids, userPeer, sophiePeer, session };
}

export type CompletedHonchoTurn = {
  userId: string;
  chatId: string;
  userMessage: { id: string; text: string; createdAt?: Date | string };
  assistantMessage: { id: string; text: string; createdAt?: Date | string };
};

function messageTime(value?: Date | string) {
  return value instanceof Date ? value : value ? new Date(value) : new Date();
}

export async function mirrorCompletedTurn(turn: CompletedHonchoTurn) {
  if (!isHonchoConfigured())
    return { mirrored: false as const, reason: 'disabled' };
  try {
    const { userPeer, sophiePeer, session } = await mappedEntities(
      turn.userId,
      turn.chatId,
    );
    const recentMessages = await session.messages({ size: 100, reverse: true });
    const mirroredIds = new Set(
      recentMessages.items
        .map((item) => item.metadata.app_message_id)
        .filter((id): id is string => typeof id === 'string'),
    );
    const messages = [
      userPeer.message(turn.userMessage.text, {
        createdAt: messageTime(turn.userMessage.createdAt),
        metadata: {
          source: 'llm-test-agent',
          app_message_id: turn.userMessage.id,
          app_role: 'user',
        },
      }),
      sophiePeer.message(turn.assistantMessage.text, {
        createdAt: messageTime(turn.assistantMessage.createdAt),
        metadata: {
          source: 'llm-test-agent',
          app_message_id: turn.assistantMessage.id,
          app_role: 'assistant',
        },
      }),
    ].filter((item) => !mirroredIds.has(String(item.metadata?.app_message_id)));
    if (messages.length > 0) await session.addMessages(messages);
    return { mirrored: true as const };
  } catch (error) {
    console.error('[honcho] completed turn mirror failed', {
      chatId: turn.chatId,
      userMessageId: turn.userMessage.id,
      assistantMessageId: turn.assistantMessage.id,
      error: error instanceof Error ? error.message : 'Unknown Honcho error',
    });
    return { mirrored: false as const, reason: 'error' };
  }
}

function serializeMessage(message: Message) {
  return {
    id: message.id,
    peerId: message.peerId,
    content: message.content,
    metadata: message.metadata,
    createdAt: message.createdAt,
  };
}

export async function inspectHoncho(userId: string, chatId: string) {
  const baseURL = process.env.HONCHO_URL?.trim();
  if (!baseURL) throw new Error('HONCHO_URL is not configured');
  const { honcho, ids, userPeer, session } = await mappedEntities(
    userId,
    chatId,
  );
  const healthRequest = fetch(`${baseURL.replace(/\/$/u, '')}/health`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(3_000),
  }).then(async (response) => ({
    ok: response.ok,
    status: response.status,
    body: await response.json().catch(() => null),
  }));
  const [health, representation, conclusionsPage, messagesPage, queue] =
    await Promise.all([
      healthRequest,
      userPeer.representation(),
      userPeer.conclusions.list({ size: 100, reverse: true }),
      session.messages({ size: 100 }),
      honcho.queueStatus({ session }),
    ]);
  return {
    health,
    ids,
    representation,
    conclusions: conclusionsPage.items.map((item) => ({
      id: item.id,
      content: item.content,
      level: item.level,
      sessionId: item.sessionId,
      createdAt: item.createdAt,
    })),
    messages: messagesPage.items.map(serializeMessage),
    queue,
  };
}

export async function queryHonchoMemory(
  userId: string,
  chatId: string,
  query: string,
) {
  const { userPeer } = await mappedEntities(userId, chatId);
  return userPeer.chat(query);
}

export type RelevantMemoryMode =
  | 'targeted_conclusions'
  | 'targeted_search_fallback'
  | 'targeted_chat';

export async function retrieveRelevantMemory(
  userId: string,
  chatId: string,
  question: string,
  mode: RelevantMemoryMode = process.env.HONCHO_RETRIEVAL_MODE ===
  'targeted_chat'
    ? 'targeted_chat'
    : 'targeted_conclusions',
) {
  const { userPeer } = await mappedEntities(userId, chatId);
  if (mode === 'targeted_chat') {
    return { mode, result: await userPeer.chat(question) };
  }
  const conclusions = await userPeer.conclusions.query(
    question,
    Number(process.env.HONCHO_CONCLUSION_CANDIDATES ?? 20),
  );
  const seen = new Set<string>();
  const diverseConclusions = conclusions
    .filter((item) => {
      const normalized = item.content
        .replace(/user_[a-f0-9-]+/giu, 'user')
        .replace(
          /\b(?:on )?[A-Z][a-z]+ \d{1,2}, \d{4}(?:,? at \d{1,2}:\d{2}:\d{2})?\b/gu,
          '',
        )
        .replace(/\s+/gu, ' ')
        .replace(/[.]+$/gu, '')
        .trim()
        .toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, Number(process.env.HONCHO_CONCLUSION_TOP_K ?? 10));
  if (diverseConclusions.length) {
    return {
      mode,
      result: diverseConclusions
        .map(
          (item) =>
            `- [${item.createdAt.slice(0, 10)}] ${item.content.replace(/user_[a-f0-9-]+/giu, 'The user')}`,
        )
        .join('\n'),
    };
  }

  // Fresh, low-volume sessions can sit below Honcho's derivation threshold for a
  // while. Search only this user's authored messages so recall works immediately
  // without allowing old Sophie speculation to become a user fact.
  const messages = await userPeer.search(question, {
    limit: Number(process.env.HONCHO_SEARCH_FALLBACK_LIMIT ?? 6),
  });
  return {
    mode: 'targeted_search_fallback' as const,
    result: messages.length
      ? messages
          .map(
            (item) =>
              `- [${item.createdAt.slice(0, 10)}] The user said: ${item.content}`,
          )
          .join('\n')
      : null,
  };
}
