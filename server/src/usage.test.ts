import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backfillPlan, spendOf, type LedgerPricing } from './usage.ts';
import type { SessionUsage } from './usage-transcript.ts';

function session(costUsd: number, unpriced = 0): SessionUsage {
  return {
    sessionId: 's',
    cwd: '/work/repo',
    entrypoint: 'sdk-cli',
    firstPrompt: 'Factory step: execute.',
    startedAt: '2026-11-23T10:00:00Z',
    finishedAt: '2026-11-23T10:05:00Z',
    requests: 3,
    tokens: { input: 1, cacheWrite: 2, cacheRead: 3, output: 4 },
    costUsd,
    model: 'claude-opus-5-5',
    unpriced,
  };
}

test('a fully priced transcript wins over the CLI figure', () => {
  const spend = spendOf(session(1.5), 2);
  assert.equal(spend.costUsd, 1.5);
  assert.equal(spend.pricedFrom, 'transcript');
  assert.equal(spend.unpricedRequests, 0);
  assert.deepEqual([spend.inputTokens, spend.cacheWriteTokens, spend.cacheReadTokens, spend.outputTokens], [1, 2, 3, 4]);
});

test('a partly priced transcript falls back to the CLI figure, which covers the unpriced responses', () => {
  const spend = spendOf(session(0.5, 1), 2);
  assert.equal(spend.costUsd, 2);
  assert.equal(spend.pricedFrom, 'cli');
  assert.equal(spend.unpricedRequests, 1);
  assert.equal(spend.cacheReadTokens, 3);
  assert.equal(spendOf(session(3, 1), 2).costUsd, 3);
});

test('a partly priced transcript without a CLI figure keeps its own price and its unpriced count', () => {
  const spend = spendOf(session(0.5, 2), null);
  assert.equal(spend.costUsd, 0.5);
  assert.equal(spend.pricedFrom, 'transcript');
  assert.equal(spend.unpricedRequests, 2);
});

test('without a transcript only the CLI totals exist', () => {
  assert.deepEqual(spendOf(null, 2, { numTurns: 7, inputTokens: 100, outputTokens: 50 }), {
    requests: 7,
    inputTokens: 100,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 50,
    costUsd: 2,
    reportedCostUsd: 2,
    pricedFrom: 'cli',
    unpricedRequests: 0,
  });
  assert.equal(spendOf(null, null).costUsd, 0);
});

test('the backfill reads again sessions priced by the CLI or with unpriced responses, and skips the rest', () => {
  const row = (sessionId: string, r: Partial<LedgerPricing>): LedgerPricing => ({
    sessionId,
    pricedFrom: 'transcript',
    costUsd: 1,
    reportedCostUsd: null,
    requests: 3,
    unpricedRequests: 0,
    ...r,
  });
  const { known, reread } = backfillPlan([
    row('priced', {}),
    row('idle', { costUsd: 0, requests: 0 }),
    row('cli', { pricedFrom: 'cli', reportedCostUsd: 2 }),
    row('partly-priced', { unpricedRequests: 1 }),
    row('unpriced-before-counting', { costUsd: 0 }),
  ]);
  assert.deepEqual([...known].sort(), ['idle', 'priced']);
  assert.deepEqual([...reread].sort(), ['cli', 'partly-priced', 'unpriced-before-counting']);
});
