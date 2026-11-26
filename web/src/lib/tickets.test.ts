import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrSweepSkip, Run, Ticket } from '@factory/shared';
import { dependenciesOf, primaryTicketAction, sweepSkipLabel, ticketFilterOf } from './tickets';

const ticket = (key: string, status: Ticket['status'], extra: Partial<Ticket> = {}) => ({ id: key, key, seq: 1, status, dependsOn: [], branch: null, ...extra }) as Ticket;

describe('primaryTicketAction', () => {
  it('offers to watch whatever agent is on the ticket', () => {
    const run = { id: 'r1', status: 'running' } as Run;
    assert.deepEqual(primaryTicketAction(ticket('a', 'building'), { approved: true, activeRun: run, waitingOn: [] }), { kind: 'watch', label: 'Watch', runId: 'r1' });
  });

  it('offers nothing before the plan is approved, or while a dependency is unbuilt', () => {
    assert.equal(primaryTicketAction(ticket('a', 'todo'), { approved: false, waitingOn: [] }), null);
    assert.equal(primaryTicketAction(ticket('a', 'todo'), { approved: true, waitingOn: [ticket('b', 'todo')] }), null);
  });

  it('picks the step that moves the ticket on', () => {
    const next = (t: Ticket) => primaryTicketAction(t, { approved: true, waitingOn: [] });
    assert.deepEqual(next(ticket('a', 'todo')), { kind: 'act', label: 'Build', action: 'run' });
    assert.deepEqual(next(ticket('a', 'built')), { kind: 'act', label: 'Review', action: 'review' });
    assert.deepEqual(next(ticket('a', 'blocked', { branch: 'b', gateStatus: 'fail' })), { kind: 'act', label: 'Re-run checks', action: 'check' });
    assert.deepEqual(next(ticket('a', 'blocked', { branch: 'b', gateStatus: 'waiting' })), { kind: 'act', label: 'Re-run checks', action: 'check' });
    assert.deepEqual(next(ticket('a', 'blocked', { branch: 'b' })), { kind: 'act', label: 'Fix', action: 'fix' });
    assert.deepEqual(next(ticket('a', 'blocked')), { kind: 'act', label: 'Retry build', action: 'run' });
    assert.equal(next(ticket('a', 'approved')), null);
  });
});

describe('ticketFilterOf', () => {
  it('files a stopped ticket under "needs you" unless the arbiter is deciding it', () => {
    assert.equal(ticketFilterOf(ticket('a', 'blocked'), []), 'needs-you');
    assert.equal(ticketFilterOf(ticket('a', 'blocked'), [{ kind: 'arbitrate', status: 'running', ticketId: 'a' } as Run]), 'in-flight');
    assert.equal(ticketFilterOf(ticket('a', 'merged'), []), 'done');
    assert.equal(ticketFilterOf(ticket('a', 'canceled'), []), 'canceled');
    assert.equal(ticketFilterOf(ticket('a', 'changes_requested'), []), 'waiting');
  });
});

describe('dependenciesOf', () => {
  it('waits only for dependencies that are neither shipped nor on a branch', () => {
    const all = [ticket('a', 'approved'), ticket('b', 'building', { branch: 'factory/b' }), ticket('c', 'todo'), ticket('d', 'todo', { dependsOn: ['a', 'b', 'c'] })];
    const { deps, waitingOn } = dependenciesOf(all[3], all);
    assert.deepEqual(
      deps.map((t) => t.key),
      ['a', 'b', 'c'],
    );
    assert.deepEqual(
      waitingOn.map((t) => t.key),
      ['c'],
    );
  });
});

describe('sweepSkipLabel', () => {
  it('does not describe external work as waiting on people', () => {
    assert.equal(
      sweepSkipLabel({ reason: 'waiting-on', waitingOn: ['API contracts: waits for a backend release'] } as PrSweepSkip),
      'waiting on people or external work',
    );
  });
});
