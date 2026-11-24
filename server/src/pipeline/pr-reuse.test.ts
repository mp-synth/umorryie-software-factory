import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readRebuildState, stateAfterReset, writeRebuildState } from './pr-reuse.ts';

const open = { prNumber: 20996, prUrl: 'https://github.com/o/r/pull/20996', prState: 'OPEN', branch: 'factory/i/04-video-entities-ttv-v2' };

test('a reset keeps the open PR of the ticket’s own branch and counts the next build', () => {
  const after = stateAfterReset({ builds: 1, reuse: null }, open);
  assert.deepEqual(after, { builds: 2, reuse: { prNumber: 20996, prUrl: open.prUrl, branch: open.branch } });
});

test('a second reset before the rebuild lands keeps the PR it already holds', () => {
  const first = stateAfterReset({ builds: 1, reuse: null }, open);
  const second = stateAfterReset(first, { prNumber: null, prUrl: null, prState: null, branch: null });
  assert.deepEqual(second, { builds: 3, reuse: first.reuse });
});

test('a closed PR, a ticket without a PR, or the owner’s own adopted PR is not kept', () => {
  assert.equal(stateAfterReset({ builds: 1, reuse: null }, { ...open, prState: 'CLOSED' }).reuse, null);
  assert.equal(stateAfterReset({ builds: 1, reuse: null }, { ...open, prNumber: null }).reuse, null);
  assert.equal(stateAfterReset({ builds: 1, reuse: null }, { ...open, prHeadRef: 'feature/mine' }).reuse, null);
});

test('the state survives on disk and reads as a first build when missing or broken', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-rebuilds-'));
  const file = path.join(dir, 'rebuilds', 'ticket.json');
  assert.deepEqual(readRebuildState(file), { builds: 1, reuse: null });
  writeRebuildState(file, stateAfterReset({ builds: 1, reuse: null }, open));
  assert.equal(readRebuildState(file).reuse?.prNumber, 20996);
  fs.writeFileSync(file, '{not json');
  assert.deepEqual(readRebuildState(file), { builds: 1, reuse: null });
});
