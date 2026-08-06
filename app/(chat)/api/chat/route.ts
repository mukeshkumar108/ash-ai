import { createUIMessageStream, JsonToSseTransformStream } from 'ai';
import { auth } from '@/app/(auth)/auth';
import { createAshAgent } from '@/lib/agent/ash-agent';
import {
  chatMessagesToLangChain,
  langChainMessageText,
} from '@/lib/agent/messages';
import {
  createStreamId,
  deleteChatById,
  getChatAccessById,
  getChatById,
  getMessagesByChatId,
  getUserById,
  saveChat,
  saveMessages,
  withQueryContext,
  db,
} from '@/lib/db/queries';
import { message as messageTable, user as userTable } from '@/lib/db/schema';
import { convertToUIMessages, generateUUID } from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { isProductionEnvironment } from '@/lib/constants';
import { postRequestBodySchema, type PostRequestBody } from './schema';
import { sanitizeText } from '@/lib/ai/sanitize';
import { logAIError } from '@/lib/ai/error-log';
import { presignFilePartUrls } from '@/lib/blob-server';
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from 'resumable-stream';
import { after } from 'next/server';
import { ChatSDKError } from '@/lib/errors';
import type { ChatMessage } from '@/lib/types';
import { type ChatModel, chatModels } from '@/lib/ai/models';
import type { VisibilityType } from '@/components/visibility-selector';

export const maxDuration = 300;
const CHAT_AGENT_TIMEOUT_MS = Number(
  process.env.CHAT_AGENT_TIMEOUT_MS ?? 240_000,
);

type RuntimeModelId = ChatModel['id'];

// Internal aliases whose underlying model accepts image input. Used to keep
// image requests from falling back to text-only models.
const VISION_CAPABLE_ALIASES = new Set<RuntimeModelId>(['chat-model']);

// Internal aliases whose underlying model is text-only (rejects image parts).
const TEXT_ONLY_ALIASES = new Set<RuntimeModelId>([
  'chat-model-fallback',
  'chat-model-reasoning',
]);

function isTextOnlyModel(modelId: RuntimeModelId): boolean {
  if (VISION_CAPABLE_ALIASES.has(modelId)) return false;
  if (TEXT_ONLY_ALIASES.has(modelId)) return true;
  const def = chatModels.find((chatModel) => chatModel.id === modelId);
  return def ? def.vision === false : false;
}

let globalStreamContext: ResumableStreamContext | null = null;

export function getStreamContext() {
  if (!globalStreamContext) {
    try {
      globalStreamContext = createResumableStreamContext({
        waitUntil: after,
      });
    } catch (error: any) {
      console.error(
        'Failed to create resumable stream context:',
        error.message,
      );
      if (error.message.includes('REDIS_URL')) {
        console.log(
          ' > Resumable streams are disabled due to missing REDIS_URL',
        );
      }
    }
  }

  return globalStreamContext;
}

export async function POST(request: Request) {
  return withQueryContext('POST /api/chat', async () => {
    let requestBody: PostRequestBody;

    try {
      const json = await request.json();
      requestBody = postRequestBodySchema.parse(json);
    } catch (_) {
      return new ChatSDKError('bad_request:api').toResponse();
    }

    try {
      const {
        id,
        message,
        selectedChatModel,
        selectedVisibilityType,
      }: {
        id: string;
        message: ChatMessage;
        selectedChatModel: ChatModel['id'];
        selectedVisibilityType: VisibilityType;
      } = requestBody;

      const session = await auth();

      if (!session?.user) {
        return new ChatSDKError('unauthorized:chat').toResponse();
      }

      const chat = await getChatById({ id });

      if (!chat) {
        const title = await generateTitleFromUserMessage({
          message,
        });

        await saveChat({
          id,
          userId: session.user.id,
          title,
          characterId: 'neutral',
          visibility: selectedVisibilityType,
          chatModel: selectedChatModel,
        });
      } else {
        if (chat.userId !== session.user.id) {
          return new ChatSDKError('forbidden:chat').toResponse();
        }
      }

      // Ensure the session user has a row so chat/message foreign keys hold.
      if (!(await getUserById(session.user.id))) {
        if (!isProductionEnvironment) {
          await db
            .insert(userTable)
            .values({
              id: session.user.id,
              email: `dev-${session.user.id.slice(0, 8)}@localhost.test`,
            })
            .onConflictDoNothing();
        } else {
          return new ChatSDKError(
            'unauthorized:chat',
            'Session user no longer exists',
          ).toResponse();
        }
      }

      const messagesFromDb = await getMessagesByChatId({ id });

      // Apply input sanitization to user message before processing
      const sanitizedMessage = {
        ...message,
        parts: message.parts?.map((part) => ({
          ...part,
          ...(part.type === 'text' && 'text' in part
            ? { text: sanitizeText(part.text) }
            : {}),
        })),
      };

      const uiMessages = [
        ...convertToUIMessages(messagesFromDb),
        sanitizedMessage,
      ].filter(
        (msg, index, self) => self.findIndex((m) => m.id === msg.id) === index,
      );

      // Keep the most recent context window for the model.
      const contextWindowSize = Number(process.env.CONTEXT_WINDOW_SIZE ?? 40);
      let messagesToSend = uiMessages.slice(-Math.max(3, contextWindowSize));

      await db
        .insert(messageTable)
        .values({
          chatId: id,
          id: message.id,
          role: 'user',
          parts: message.parts as any,
          attachments: [],
          createdAt: new Date(),
        })
        .onConflictDoNothing();

      let modelToUse: RuntimeModelId = selectedChatModel;

      const hasImageParts = sanitizedMessage.parts.some(
        (part) => part.type === 'file',
      );

      if (hasImageParts && isTextOnlyModel(selectedChatModel)) {
        console.warn(
          `[chat] ${selectedChatModel} does not support image input; falling back to chat-model`,
        );
        modelToUse = 'chat-model';
      }

      // Text-only models reject image parts anywhere in the context (including
      // history), so strip them before building the model messages.
      if (isTextOnlyModel(modelToUse)) {
        messagesToSend = messagesToSend.map((entry) => ({
          ...entry,
          parts: entry.parts.filter(
            (part) => part.type !== 'file',
          ) as ChatMessage['parts'],
        }));
      }

      const presignedMessages = await presignFilePartUrls(messagesToSend);

      // Run the agent to completion before streaming so the assistant message
      // is persisted before the response is returned. This keeps conversation
      // persistence deterministic and makes reconnect/resume restorations
      // reliable without a token-by-token model stream.
      const assistantId = generateUUID();
      const textPartId = generateUUID();
      let finalText = '';

      try {
        const agent = createAshAgent({
          userId: session.user.id,
          modelId: modelToUse,
        });

        const lcMessages = chatMessagesToLangChain(presignedMessages);
        const agentSignal = AbortSignal.any([
          request.signal,
          AbortSignal.timeout(CHAT_AGENT_TIMEOUT_MS),
        ]);
        const result = await agent.invoke(
          { messages: lcMessages },
          { signal: agentSignal },
        );

        const lastAi = [...result.messages]
          .reverse()
          .find(
            (entry: unknown) =>
              typeof (entry as { getType?: () => string })?.getType ===
                'function' &&
              (entry as { getType: () => string }).getType() === 'ai',
          );

        finalText = langChainMessageText(lastAi);
      } catch (error) {
        logAIError('chat-agent', error);
        throw error;
      }

      if (!finalText) {
        finalText = 'I could not generate a response.';
      }

      await saveMessages({
        messages: [
          {
            id: assistantId,
            role: 'assistant',
            parts: [{ type: 'text', text: finalText }],
            createdAt: new Date(),
            attachments: [],
            chatId: id,
          },
        ],
      });

      // Buffered delivery has nothing resumable until the graph has completed
      // and its final assistant message is durable. Creating the stream record
      // here avoids orphaned resumable-stream IDs on cancellation or failure.
      const streamId = generateUUID();
      await createStreamId({ streamId, chatId: id });

      const stream = createUIMessageStream({
        execute: async ({ writer: dataStream }) => {
          dataStream.write({ type: 'start', messageId: assistantId });
          dataStream.write({ type: 'text-start', id: textPartId });
          dataStream.write({
            type: 'text-delta',
            id: textPartId,
            delta: finalText,
          });
          dataStream.write({ type: 'text-end', id: textPartId });
          dataStream.write({ type: 'finish' });
        },
        generateId: generateUUID,
      });

      const streamContext = getStreamContext();

      if (streamContext) {
        return new Response(
          await streamContext.resumableStream(streamId, () =>
            stream.pipeThrough(new JsonToSseTransformStream()),
          ),
        );
      } else {
        return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
      }
    } catch (error) {
      if (error instanceof ChatSDKError) {
        return error.toResponse();
      }
      logAIError('chat-route', error);
      return new Response(
        JSON.stringify({ error: 'An unexpected error occurred.' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
  });
}

export async function DELETE(request: Request) {
  return withQueryContext('DELETE /api/chat', async () => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return new ChatSDKError('bad_request:api').toResponse();
    }

    const session = await auth();

    if (!session?.user) {
      return new ChatSDKError('unauthorized:chat').toResponse();
    }

    const chat = await getChatAccessById({ id });

    if (!chat) {
      return new ChatSDKError('not_found:chat').toResponse();
    }

    if (chat.userId !== session.user.id) {
      return new ChatSDKError('forbidden:chat').toResponse();
    }

    const deletedChat = await deleteChatById({ id });

    return Response.json(deletedChat, { status: 200 });
  });
}
