import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrDetail } from '../pr-view.ts';
import type { RememberedStorage } from './memory.ts';
import { isDrainablePrAttention, PrAttentionQueue, prAttentionFingerprint } from './pr-attention.ts';

class MemoryStorage implements RememberedStorage {
  readonly rows = new Map<string, string>();

  async recallPrefix(prefix: string): Promise<Map<string, string>> {
    return new Map([...this.rows].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value]));
  }

  async remember(key: string, value: string | null): Promise<void> {
    if (value === null) this.rows.delete(key);
    else this.rows.set(key, value);
  }
}

const attention = (fingerprint: string) => ({
  initiativeId: 'initiative-a',
  fingerprint,
  headSha: `head-${fingerprint}`,
});

test('persists changed PR attention once and restores it after a restart', async () => {
  const storage = new MemoryStorage();
  const queue = new PrAttentionQueue(storage);
  assert.equal(await queue.note('ticket-a', attention('one'), '2026-01-01T10:00:00Z'), true);
  assert.equal(await queue.note('ticket-a', attention('one'), '2026-01-01T10:01:00Z'), false);

  const restored = new PrAttentionQueue(storage);
  assert.deepEqual(await restored.ticketIds('initiative-a'), new Set(['ticket-a']));
  assert.equal((await restored.get('ticket-a'))?.detectedAt, '2026-01-01T10:00:00Z');
});

test('keeps a newer PR change queued when it arrives during the claimed fix round', async () => {
  const queue = new PrAttentionQueue(new MemoryStorage());
  await queue.note('ticket-a', attention('one'));
  assert.equal(await queue.claim('ticket-a', 'one'), true);

  await queue.note('ticket-a', attention('two'));
  assert.equal(await queue.beginPropagation('ticket-a'), 'none', 'a succeeded sub-step is not enough to end the atomic chain');
  assert.equal(await queue.markHandoffReady('ticket-a'), true);
  assert.equal(await queue.beginPropagation('ticket-a'), 'ready');
  assert.equal(await queue.completePropagation('ticket-a'), 'changed');
  assert.equal((await queue.get('ticket-a'))?.fingerprint, 'two');

  assert.equal(await queue.claim('ticket-a', 'two'), true);
  await queue.markHandoffReady('ticket-a');
  assert.equal(await queue.beginPropagation('ticket-a'), 'ready');
  assert.deepEqual(await queue.pendingTicketIds('initiative-a'), new Set(), 'propagation blocks the stack but is not swept as another fix');
  assert.deepEqual(await queue.ticketIds('initiative-a'), new Set(['ticket-a']));
  assert.equal(await queue.completePropagation('ticket-a'), 'settled');
  assert.equal(await queue.get('ticket-a'), undefined);
});

test('a comment that arrives during propagation remains queued after the stack sync', async () => {
  const queue = new PrAttentionQueue(new MemoryStorage());
  await queue.note('ticket-a', attention('one'));
  await queue.claim('ticket-a', 'one');
  await queue.markHandoffReady('ticket-a');
  assert.equal(await queue.beginPropagation('ticket-a'), 'ready');
  await queue.releaseClaim('ticket-a', 'one');
  assert.equal((await queue.get('ticket-a'))?.propagating, true, 'recovery cannot downgrade an unfinished propagation');
  await queue.note('ticket-a', attention('two'));
  assert.equal(await queue.completePropagation('ticket-a'), 'changed');
  assert.deepEqual(await queue.pendingTicketIds('initiative-a'), new Set(['ticket-a']));
});

test('every started sweep owns durable attention and claims a newer observation atomically', async () => {
  const queue = new PrAttentionQueue(new MemoryStorage());
  assert.equal(await queue.claimLatest('ticket-a', attention('fallback'), '2026-01-01T10:00:00Z'), 'fallback');
  assert.equal((await queue.get('ticket-a'))?.claimedFingerprint, 'fallback');

  await queue.releaseClaim('ticket-a', 'fallback');
  await queue.note('ticket-a', attention('newer'));
  assert.equal(await queue.claimLatest('ticket-a', attention('stale-fallback')), 'newer');
  assert.equal((await queue.get('ticket-a'))?.claimedFingerprint, 'newer');
});

const detail = (patch: Partial<PrDetail['snapshot']> = {}, threadBody = 'rename this'): PrDetail =>
  ({
    snapshot: {
      state: 'OPEN',
      isDraft: false,
      url: 'https://github.com/acme/widgets/pull/1',
      mergeable: 'MERGEABLE',
      baseRefName: 'main',
      headRefOid: 'a1',
      failingChecks: [],
      supersededChecks: [],
      pendingChecks: [],
      finishedChecks: 3,
      hungJobs: [],
      comments: [],
      reviews: [],
      ...patch,
    },
    threads: [
      {
        id: 'thread-1',
        rootCommentId: 1,
        rootAuthor: 'reviewer',
        rootIsBot: false,
        path: 'a.ts',
        line: 1,
        outdated: false,
        awaitingReviewer: false,
        lastCommentAt: '2026-01-01T10:00:00Z',
        comments: [{ author: 'reviewer', body: threadBody }],
      },
    ],
    checks: [],
  }) as PrDetail;

test('attention fingerprint moves with review work and settled check details hidden by the light rollup', () => {
  const base = prAttentionFingerprint('light', detail());
  assert.notEqual(prAttentionFingerprint('light', detail({}, 'use a clearer name')), base);
  assert.notEqual(prAttentionFingerprint('light', detail({ pendingChecks: ['test'] })), base);
  assert.notEqual(prAttentionFingerprint('light', detail({ failingChecks: [{ name: 'test', url: null }] as never[] })), base);
  assert.notEqual(prAttentionFingerprint('new-light', detail()), base);
});

test('only actionable settled tickets hold a stack line as drainable attention', () => {
  assert.equal(isDrainablePrAttention({ status: 'approved', gateStatus: 'pass' }, false, true), true);
  assert.equal(isDrainablePrAttention({ status: 'blocked', gateStatus: 'fail' }, false, true), false);
  assert.equal(isDrainablePrAttention({ status: 'approved', gateStatus: 'infra' }, false, true), false);
  assert.equal(isDrainablePrAttention({ status: 'approved', gateStatus: 'pass' }, true, true), false);
  assert.equal(isDrainablePrAttention({ status: 'approved', gateStatus: 'pass' }, false, false), false);
});
