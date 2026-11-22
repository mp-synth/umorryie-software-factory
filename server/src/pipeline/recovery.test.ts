import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Run } from '@factory/shared';
import { REQUEUE_LIMIT, orphanRunKind, restingInitiativeStatus, restingTicketStatus, shouldResumeInterrupted, startupFate, type RunLeftRunning } from './recovery.ts';

const run = (over: Partial<Run> = {}) =>
  ({ id: 'r1', initiativeId: 'i1', ticketId: 't1', kind: 'review', round: 1, status: 'interrupted', queuedAt: '2026-01-01T00:00:00Z', ...over }) as Run;

test('restingTicketStatus picks the status a stopped step falls back to', () => {
  assert.equal(restingTicketStatus('execute', false, false), 'todo');
  assert.equal(restingTicketStatus('execute', true, false), 'blocked');
  assert.equal(restingTicketStatus('gate', true, false), 'built');
  assert.equal(restingTicketStatus('review', true, false), 'built');
  assert.equal(restingTicketStatus('fix', true, false), 'changes_requested');
  assert.equal(restingTicketStatus('verify', true, false), 'built');
  assert.equal(restingTicketStatus('fix', true, true), 'blocked');
  assert.equal(restingTicketStatus('execute', false, true), 'blocked');
});

test('restingInitiativeStatus keeps a plan when there is one and only fails a plan that errored', () => {
  assert.equal(restingInitiativeStatus('plan', true, false), 'awaiting_approval');
  assert.equal(restingInitiativeStatus('plan_review', true, true), 'awaiting_approval');
  assert.equal(restingInitiativeStatus('plan', false, false), 'draft');
  assert.equal(restingInitiativeStatus('plan', false, true), 'failed');
  assert.equal(restingInitiativeStatus('plan_review', false, true), 'draft');
});

test('orphanRunKind maps active statuses to the step that was running', () => {
  assert.equal(orphanRunKind('building'), 'execute');
  assert.equal(orphanRunKind('checking'), 'gate');
  assert.equal(orphanRunKind('in_review'), 'review');
  assert.equal(orphanRunKind('fixing'), 'fix');
  assert.equal(orphanRunKind('planning'), 'plan');
  assert.equal(orphanRunKind('plan_review'), 'plan_review');
  assert.equal(orphanRunKind('blocked'), null);
});

test('shouldResumeInterrupted resumes a step once per round', () => {
  const base = { run: run(), earlier: [run()], enabled: true, sweepOwned: false };
  assert.equal(shouldResumeInterrupted(base), true);
  assert.equal(shouldResumeInterrupted({ ...base, enabled: false }), false);
  assert.equal(shouldResumeInterrupted({ ...base, run: run({ kind: 'ask' }), earlier: [] }), false);
  assert.equal(shouldResumeInterrupted({ ...base, earlier: [run(), run({ id: 'r0' })] }), false);
});

test('shouldResumeInterrupted only counts earlier interruptions of the same kind, round and scope', () => {
  const base = { run: run(), enabled: true, sweepOwned: false };
  assert.equal(shouldResumeInterrupted({ ...base, earlier: [run({ id: 'r0', kind: 'fix' })] }), true);
  assert.equal(shouldResumeInterrupted({ ...base, earlier: [run({ id: 'r0', round: 0 })] }), true);
  assert.equal(shouldResumeInterrupted({ ...base, earlier: [run({ id: 'r0', ticketId: 't2' })] }), true);
  assert.equal(shouldResumeInterrupted({ ...base, earlier: [run({ id: 'r0', status: 'failed' })] }), true);
  assert.equal(shouldResumeInterrupted({ ...base, earlier: [run({ id: 'r0', ticketId: null })] }), true);
});

test('shouldResumeInterrupted forgets interruptions from before the latest success of the step', () => {
  const at = (id: string, status: Run['status'], queuedAt: string) => run({ id, status, queuedAt });
  const current = at('r3', 'interrupted', '2026-01-01T03:00:00Z');
  const base = { run: current, enabled: true, sweepOwned: false };
  const earlier = [at('r1', 'interrupted', '2026-01-01T01:00:00Z'), at('r2', 'succeeded', '2026-01-01T02:00:00Z')];
  assert.equal(shouldResumeInterrupted({ ...base, earlier }), true);
  assert.equal(shouldResumeInterrupted({ ...base, earlier: [...earlier, at('r2b', 'interrupted', '2026-01-01T02:30:00Z')] }), false);
  assert.equal(shouldResumeInterrupted({ ...base, earlier: [earlier[0]] }), false);
  assert.equal(shouldResumeInterrupted({ ...base, earlier: [...earlier, run({ id: 'r9', kind: 'fix', status: 'succeeded', queuedAt: '2026-01-01T02:45:00Z' }), at('r2c', 'interrupted', '2026-01-01T02:40:00Z')] }), false);
});

test('shouldResumeInterrupted leaves a sweep fix to the sweep but resumes other sweep steps', () => {
  const base = { earlier: [], enabled: true, sweepOwned: true };
  assert.equal(shouldResumeInterrupted({ ...base, run: run({ kind: 'fix' }) }), false);
  assert.equal(shouldResumeInterrupted({ ...base, run: run({ kind: 'verify' }) }), true);
});

test('shouldResumeInterrupted scopes plan steps to the initiative', () => {
  const plan = run({ kind: 'plan', ticketId: null });
  const other = run({ id: 'r0', kind: 'plan', ticketId: null, initiativeId: 'i2' });
  assert.equal(shouldResumeInterrupted({ run: plan, earlier: [other], enabled: true, sweepOwned: false }), true);
  assert.equal(shouldResumeInterrupted({ run: plan, earlier: [{ ...other, initiativeId: 'i1' }], enabled: true, sweepOwned: false }), false);
});

const leftRunning = (over: Partial<RunLeftRunning> = {}): RunLeftRunning => ({ process: null, settingUp: false, pid: null, crashRequeues: 0, serverStoppedOnPurpose: false, ...over });

test('startupFate follows a run whose process is alive or has finished', () => {
  assert.equal(startupFate(leftRunning({ process: 'follow', pid: 4242 })), 'follow');
  assert.equal(startupFate(leftRunning({ process: 'collect' })), 'follow');
  assert.equal(startupFate(leftRunning({ process: 'follow', settingUp: true })), 'follow');
  assert.equal(startupFate(leftRunning({ process: 'collect', settingUp: true, crashRequeues: REQUEUE_LIMIT })), 'follow');
});

test('startupFate queues a run again that never started a process', () => {
  assert.equal(startupFate(leftRunning()), 'requeue');
  assert.equal(startupFate(leftRunning({ crashRequeues: REQUEUE_LIMIT - 1 })), 'requeue');
});

test('startupFate queues a run again whose setup command is gone, because its agent never started', () => {
  assert.equal(startupFate(leftRunning({ process: 'interrupt', settingUp: true })), 'requeue');
});

test('startupFate interrupts a run whose agent or checks process is gone', () => {
  assert.equal(startupFate(leftRunning({ process: 'interrupt' })), 'interrupt');
  assert.equal(startupFate(leftRunning({ process: 'interrupt', pid: 4242, crashRequeues: 2 })), 'interrupt');
  assert.equal(startupFate(leftRunning({ process: 'interrupt', serverStoppedOnPurpose: true })), 'interrupt');
});

test('startupFate interrupts a run from before runs were spooled, which has a pid and no spool', () => {
  assert.equal(startupFate(leftRunning({ pid: 4242 })), 'interrupt');
});

test('startupFate stops queueing a run again once a dying server caught it setting up as often as the limit allows', () => {
  assert.equal(startupFate(leftRunning({ crashRequeues: REQUEUE_LIMIT })), 'hold');
  assert.equal(startupFate(leftRunning({ crashRequeues: REQUEUE_LIMIT + 3 })), 'hold');
  assert.equal(startupFate(leftRunning({ process: 'interrupt', settingUp: true, crashRequeues: REQUEUE_LIMIT })), 'hold');
});

test('startupFate always queues a never-started run again after a stop the owner asked for', () => {
  assert.equal(startupFate(leftRunning({ serverStoppedOnPurpose: true })), 'requeue');
  assert.equal(startupFate(leftRunning({ serverStoppedOnPurpose: true, crashRequeues: REQUEUE_LIMIT + 3 })), 'requeue');
  assert.equal(startupFate(leftRunning({ process: 'interrupt', settingUp: true, serverStoppedOnPurpose: true, crashRequeues: REQUEUE_LIMIT })), 'requeue');
});
