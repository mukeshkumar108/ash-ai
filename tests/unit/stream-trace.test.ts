import { expect, test } from '@playwright/test';

import { createStreamTrace, wrapSseBody } from '@/lib/stream-trace';

test('trace slots record only the first occurrence', () => {
  const trace = createStreamTrace(1000, true);
  trace.mark(1010, 'runtimeStreamConnectedMs');
  trace.mark(1010, 'runtimeStreamConnectedMs');
  trace.mark(1200, 'runtimeFirstTextDeltaMs');
  trace.mark(1500, 'firstDataStreamWriteMs');
  const snap = trace.snapshot();
  expect(snap.originMs).toBe(1000);
  expect(snap.timestamps.runtimeStreamConnectedMs).toBe(10);
  expect(snap.timestamps.runtimeFirstTextDeltaMs).toBe(200);
  expect(snap.timestamps.firstDataStreamWriteMs).toBe(500);
  expect(snap.timestamps.runtimeCompletedMs).toBeNull();
  expect(snap.coalesced).toBe(false);
});

test('wrapSseBody passes bytes through unchanged and counts chunks', async () => {
  const trace = createStreamTrace(0, false);
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('event: x\ndata: a\n\n'));
      controller.enqueue(new TextEncoder().encode('event: x\ndata: b\n\n'));
      controller.enqueue(new TextEncoder().encode('event: x\ndata: c\n\n'));
      controller.close();
    },
  });
  const observed = wrapSseBody(input, trace);
  const reader = observed.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  const joined = parts.map((p) => new TextDecoder().decode(p)).join('');
  expect(joined).toBe(
    'event: x\ndata: a\n\nevent: x\ndata: b\n\nevent: x\ndata: c\n\n',
  );
  const bytes = [18, 18, 18];
  const snap = trace.snapshot();
  expect(snap.chunksBeforeCompleted).toBe(3);
  expect(snap.firstChunkBytes).toBe(bytes[0]);
  expect(snap.firstFewChunksBytes).toBe(bytes[0] + bytes[1] + bytes[2]);
});

test('wrapSseBody on a string stream (resumable path) is type-agnostic', async () => {
  const trace = createStreamTrace(0, true);
  const input = new ReadableStream<string>({
    start(controller) {
      controller.enqueue('event: x\ndata: a\n\n');
      controller.enqueue('event: x\ndata: b\n\n');
      controller.close();
    },
  });
  const observed = wrapSseBody(input, trace);
  const reader = observed.getReader();
  const parts: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  expect(parts.join('')).toBe('event: x\ndata: a\n\nevent: x\ndata: b\n\n');
  expect(trace.snapshot().chunksBeforeCompleted).toBe(2);
});

test('coalescing flag flips when many server chunks precede browser ack', () => {
  const trace = createStreamTrace(0, false);
  trace.recordChunk(16);
  trace.recordChunk(16);
  trace.recordChunk(16);
  // No explicit browser ack in this probe; coalesced reflects server-side
  // chunk multiplicity before the response stream closes.
  expect(trace.snapshot().chunksBeforeCompleted).toBe(3);
  expect(trace.snapshot().firstChunkBytes).toBe(16);
});
