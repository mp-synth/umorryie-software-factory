import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Ticket } from '@factory/shared';
import { renderTicket } from './files.ts';

let seq = 0;
const ticket = (key: string, dependsOn: string[] = [], status: Ticket['status'] = 'todo'): Ticket => ({
  id: `id-${key}`,
  initiativeId: 'init',
  key,
  seq: ++seq,
  wave: dependsOn.length,
  title: `Build the ${key} slice`,
  what: 'Adds a thing.',
  goal: 'So the thing works.',
  outcome: 'GET /thing returns 200.',
  guidance: ['Touch src/thing.ts'],
  acceptance: ['The route answers'],
  dependsOn,
  needs: dependsOn,
  size: 'S',
  status,
  round: 0,
  branch: status === 'todo' ? null : `factory/x/${key}`,
  baseRef: null,
  worktreePath: null,
  prNumber: null,
  prUrl: null,
  prState: null,
  prHeadRef: null,
  prStack: null,
  lastVerdict: null,
  gateStatus: null,
  blockedReason: null,
  prSweepClaimedAt: null,
  prSweepFingerprint: null,
  createdAt: '2026-11-25T00:00:00Z',
  updatedAt: '2026-11-25T00:00:00Z',
});

test('ticket.md names the tickets built beside it and on top of it', () => {
  const all = [
    ticket('api', [], 'approved'),
    ticket('admins', ['api'], 'building'),
    ticket('create', ['api'], 'building'),
    ticket('gone', ['api'], 'canceled'),
    ticket('update', ['create']),
  ];
  const md = renderTicket(all[2], all);
  assert.match(md, /## Depends on\n- .*key api, branch factory\/x\/api, approved/);
  assert.match(md, /## Built beside it\n.*\n- .*key admins/);
  assert.doesNotMatch(md, /key gone/);
  assert.match(md, /## Built on top of it\n.*\n- .*key update/);
});

test('ticket.md has no beside or on-top sections for a lone ticket', () => {
  const lone = ticket('solo');
  const md = renderTicket(lone, [lone, ticket('other')]);
  assert.doesNotMatch(md, /Built beside it|Built on top of it/);
});
