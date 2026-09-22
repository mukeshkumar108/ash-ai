import { expect, test } from '@playwright/test';

import {
  decideCandidateReceiptDelivery,
  deliverCandidateReceiptOnce,
  isCandidateReceiptDue,
} from '@/lib/cortex/candidate-receipt-outbox';

test.beforeEach(() => {
  process.env.SYNAPSE_CORTEX_URL = 'https://cortex.test';
  process.env.SYNAPSE_CORTEX_API_TOKEN = 'test-token';
  process.env.SYNAPSE_CORTEX_ENABLED = undefined;
});

test('candidate receipt due policy excludes delivered rows and live leases', () => {
  const now = new Date('2026-09-22T12:00:00Z');
  expect(isCandidateReceiptDue({ status: 'pending' }, now)).toBe(true);
  expect(
    isCandidateReceiptDue(
      { status: 'retrying', nextAttemptAt: new Date(now.getTime() - 1) },
      now,
    ),
  ).toBe(true);
  expect(
    isCandidateReceiptDue(
      { status: 'pending', lockedUntil: new Date(now.getTime() + 1) },
      now,
    ),
  ).toBe(false);
  expect(isCandidateReceiptDue({ status: 'delivered' }, now)).toBe(false);
});

test('permanent candidate receipt failures are quarantined', () => {
  expect(decideCandidateReceiptDelivery(404, null)).toBe('blocked');
  expect(decideCandidateReceiptDelivery(409, null)).toBe('blocked');
  expect(decideCandidateReceiptDelivery(422, null)).toBe('blocked');
  expect(decideCandidateReceiptDelivery(503, null)).toBe('retry');
});

test('delivers a scoped product receipt without inventing an asked effect', async () => {
  let body: Record<string, unknown> | null = null;
  let authorization: string | null = null;
  const post = async (_url: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    authorization = new Headers(init?.headers).get('authorization');
    return new Response(JSON.stringify({ accepted: 1, duplicates: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const result = await deliverCandidateReceiptOnce(
    {
      receiptId: 'receipt-1',
      decisionId: 'decision-1',
      turnId: 'turn-1',
      candidateId: 'recurring_occurrence:one',
      candidateVersion: 'v1',
      workspaceId: 'workspace-1',
      ownerPeerId: 'owner-1',
      assistantMessageId: '00000000-0000-0000-0000-000000000001',
      occurredAt: new Date('2026-09-22T12:00:00Z'),
    },
    { post: post as typeof fetch },
  );

  expect(result.action).toBe('delivered');
  expect(authorization).toBe('Bearer test-token');
  expect(body).toMatchObject({
    contract_version: 'candidate-receipts-v1',
    workspace_id: 'workspace-1',
    owner_peer_id: 'owner-1',
    receipts: [
      {
        receipt_id: 'receipt-1',
        decision_id: 'decision-1',
        turn_id: 'turn-1',
        candidate_id: 'recurring_occurrence:one',
        candidate_version: 'v1',
        stage: 'delivered',
        channel: 'inbound',
        assistant_message_id: '00000000-0000-0000-0000-000000000001',
        effect: null,
      },
    ],
  });
});
