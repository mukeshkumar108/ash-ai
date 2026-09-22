/* eslint-disable no-console */
/**
 * Boundary-only streaming telemetry. Pure observation: it marks monotonic
 * timestamps along the streaming path and wraps the final Vercel SSE response
 * stream in a pass-through transform that counts/measures chunks without
 * altering any streaming semantics (no buffering, no Redis changes, no AI SDK,
 * runtime, or provider changes).
 *
 * The row persists to the app DB via the shared drizzle `db` proxy, fail-open,
 * within the caller's `after()` so the edge function can flush without blocking
 * the response.
 */
import { db } from '@/lib/db/queries';
import { streamTrace } from '@/lib/db/schema';

export type StreamTraceSlot =
  | 'runtimeStreamConnectedMs'
  | 'runtimeFirstTextDeltaMs'
  | 'firstDataStreamWriteMs'
  | 'firstOutputChunkMs'
  | 'runtimeCompletedMs'
  | 'responseStreamClosedMs';

export interface StreamTraceObservation {
  resumableEnabled: boolean;
  originMs: number;
  mark(ms: number, slot: StreamTraceSlot): void;
  recordChunk(bytes: number): void;
  snapshot(): {
    timestamps: Record<StreamTraceSlot, number | null>;
    originMs: number;
    chunksBeforeCompleted: number;
    firstChunkBytes: number | null;
    firstFewChunksBytes: number | null;
    coalesced: boolean;
  };
}

const emptyTimestamps = (): Record<StreamTraceSlot, number | null> => ({
  runtimeStreamConnectedMs: null,
  runtimeFirstTextDeltaMs: null,
  firstDataStreamWriteMs: null,
  firstOutputChunkMs: null,
  runtimeCompletedMs: null,
  responseStreamClosedMs: null,
});

/**
 * Create the trace accumulator. `origin` is the monotonic ms when the chat
 * route streaming branch started (performance.now()). All reported slots are
 * deltas from that origin (ms). `chatRouteStartedMs` is captured at write time
 * as the wall-clock startup relative figure for cross-request sanity.
 */
export function createStreamTrace(
  origin: number,
  resumableEnabled: boolean,
): StreamTraceObservation {
  const timestamps = emptyTimestamps();
  let chunksBeforeCompleted = 0;
  let recordedFirst = false;
  let firstChunkBytes: number | null = null;
  let firstFewChunksBytes: number | null = null;
  const offsetForBrowser: { firstChunkWall: number | null } = {
    firstChunkWall: null,
  };

  const mark = (ms: number, slot: StreamTraceSlot) => {
    if (timestamps[slot] === null) timestamps[slot] = ms - origin;
  };

  return {
    resumableEnabled,
    originMs: origin,
    mark,
    recordChunk(bytes: number) {
      chunksBeforeCompleted += 1;
      if (!recordedFirst) {
        recordedFirst = true;
        firstChunkBytes = bytes;
        firstFewChunksBytes = bytes;
        offsetForBrowser.firstChunkWall = Date.now();
      } else if (chunksBeforeCompleted <= 3) {
        firstFewChunksBytes = (firstFewChunksBytes ?? 0) + bytes;
      }
    },
    snapshot() {
      return {
        timestamps: { ...timestamps },
        originMs: origin,
        chunksBeforeCompleted,
        firstChunkBytes,
        firstFewChunksBytes,
        coalesced: (firstChunkBytes ?? 0) > 0 && chunksBeforeCompleted > 2,
      };
    },
  };
}

/**
 * Pass-through SSE body observer. Wraps the FINAL Response body stream only.
 * Each SSE "chunk" that Vercel delivers to the browser is counted/measured here
 * and passed through untouched. `flush` marks response-stream close.
 */
export function wrapSseBody<T>(
  body: ReadableStream<T>,
  trace: StreamTraceObservation,
): ReadableStream<T> {
  return body.pipeThrough(
    new TransformStream<T, T>({
      transform(chunk, controller) {
        const bytes =
          typeof chunk === 'string'
            ? new TextEncoder().encode(chunk).byteLength
            : (chunk as Uint8Array).byteLength;
        trace.recordChunk(bytes);
        controller.enqueue(chunk);
      },
      flush() {
        trace.mark(Date.now(), 'responseStreamClosedMs');
      },
    }),
  );
}

const truncate = (s: string) => (s.length > 500 ? `${s.slice(0, 496)}…` : s);

export async function persistStreamTrace(info: {
  turnId: string;
  chatId: string;
  env: string;
  trace: StreamTraceObservation;
  runtimeTiming: unknown | null;
  error?: unknown;
}): Promise<void> {
  try {
    const snap = info.trace.snapshot();
    await db.insert(streamTrace).values({
      turnId: info.turnId as never,
      chatId: info.chatId as never,
      env: info.env,
      resumableEnabled: info.trace.resumableEnabled,
      chatRouteStartedMs: snap.originMs,
      runtimeStreamConnectedMs: snap.timestamps.runtimeStreamConnectedMs,
      runtimeFirstTextDeltaMs: snap.timestamps.runtimeFirstTextDeltaMs,
      firstDataStreamWriteMs: snap.timestamps.firstDataStreamWriteMs,
      firstOutputChunkMs: snap.timestamps.firstOutputChunkMs,
      runtimeCompletedMs: snap.timestamps.runtimeCompletedMs,
      responseStreamClosedMs: snap.timestamps.responseStreamClosedMs,
      chunksBeforeCompleted: snap.chunksBeforeCompleted,
      firstChunkBytes: snap.firstChunkBytes,
      firstFewChunksBytes: snap.firstFewChunksBytes,
      coalescedIntoFirstBrowserChunk: snap.coalesced,
      runtimeTiming: (info.runtimeTiming ?? null) as never,
      error: info.error ? truncate(String(info.error)) : null,
    });
  } catch (error) {
    console.warn('[stream-trace] persist failed (fail-open)', error);
  }
}

/** wall-clock ms of the first recorded Vercel output chunk, for browser deltas */
export function firstChunkWallMs(trace: StreamTraceObservation): number | null {
  return trace.snapshot().firstChunkBytes !== null ? Date.now() : null;
}
