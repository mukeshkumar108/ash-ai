import 'server-only';

import { listTasksForUser } from '@/lib/tasks/domain';
import {
  commitInterpreterActions,
  runCommitmentInterpreter,
  type CommittedFastAction,
  type InterpreterClarification,
} from './interpreter';

/**
 * Fast-path semantic owner. Runs AFTER the visible reply is durable so it can
 * anchor interpretation to what Sophie actually said. Model proposes, code
 * commits: the interpreter only produces bounded, verbatim-evidenced actions
 * and this module disposes of them through deterministic domain mutations.
 *
 * Never throws: failures degrade to "no fast-path actions" and the background
 * Cortex pipeline still sees the turn unchanged.
 */
export type TurnSemanticsCommitResult = {
  committed: CommittedFastAction[];
  clarifications: InterpreterClarification[];
  rejected: Array<{ action: unknown; reason: string }>;
};

export async function commitTurnSemantics(input: {
  userId: string;
  chatId: string | null;
  /** Stable app message id — the origin/provenance key for fast-path actions. */
  messageId: string;
  userText: string;
  assistantText: string;
  localTime: string;
  timeZone: string;
  recentContext?: string;
  signal?: AbortSignal;
  generate?: () => Promise<unknown>;
  __resolvedRoster?: { taskId: string; title: string; dueAt: Date | null }[];
}): Promise<TurnSemanticsCommitResult> {
  const empty = { committed: [], clarifications: [], rejected: [] };

  if (!input.messageId) return empty;
  const roster =
    input.__resolvedRoster ??
    (await listTasksForUser(input.userId, { status: 'pending' })).map(
      (task) => ({
        taskId: task.id,
        title: task.title,
        dueAt: task.dueAt,
      }),
    );

  const interpretation = await runCommitmentInterpreter({
    userText: input.userText,
    assistantText: input.assistantText,
    roster,
    localTime: input.localTime,
    timeZone: input.timeZone,
    recentContext: input.recentContext,
    signal: input.signal,
    generate: input.generate,
  });

  return commitInterpreterActions({
    interpretation,
    userText: input.userText,
    userId: input.userId,
    chatId: input.chatId,
    timeZone: input.timeZone,
    roster,
    originMessageId: input.messageId,
    recentContext: input.recentContext,
  });
}