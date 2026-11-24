import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlanTicket, Ticket } from '@factory/shared';
import { validatePlan } from './plan.ts';
import { planTicketSeqs, renameCanceledKeys, replanAwaitsAnswers, revisePlannedTickets, sameSpec } from './replan.ts';

type Row = Parameters<typeof revisePlannedTickets>[2][number];

function spec(key: string, extra: Partial<PlanTicket> = {}): PlanTicket {
  return { key, title: `Ticket ${key}`, what: `Does ${key}.`, goal: 'g', outcome: 'o', guidance: ['x'], acceptance: ['y'], depends_on: [], size: 'S', ...extra };
}

function row(key: string, seq: number, status: Ticket['status'], branch: string | null, extra: Partial<PlanTicket> = {}): Row {
  const s = spec(key, extra);
  return { id: `id-${key}`, key, seq, status, branch, title: s.title, what: s.what, goal: s.goal, outcome: s.outcome, guidance: s.guidance, acceptance: s.acceptance, dependsOn: s.depends_on, size: s.size };
}

const order = (...keys: string[]) => keys.map((key, i) => ({ key, seq: i + 1, wave: i }));
const keys = (rows: Row[]) => rows.map((r) => r.key);

test('a first approval finds only the plan’s own proposed tickets and changes nothing', () => {
  const r = revisePlannedTickets([spec('a'), spec('b')], order('a', 'b'), [row('a', 1, 'proposed', null), row('b', 2, 'proposed', null)]);
  assert.deepEqual([r.keep.length, r.rebuild, r.restart, r.drop], [0, [], [], []]);
});

test('a revised plan rebuilds built tickets whose text changed, restarts unstarted ones and drops what it left out', () => {
  const existing = [
    row('same', 1, 'approved', 'factory/i/01-same'),
    row('changed', 2, 'in_review', 'factory/i/02-changed', { depends_on: ['same'] }),
    row('later', 3, 'todo', null, { depends_on: ['changed'] }),
    row('gone', 4, 'built', 'factory/i/04-gone'),
    row('shipped', 5, 'merged', 'factory/i/05-shipped'),
    row('fresh', 6, 'proposed', null),
  ];
  const planned = [spec('same'), spec('changed', { what: 'Does it the new way.', depends_on: ['same'] }), spec('later', { acceptance: ['z'], depends_on: ['changed'] }), spec('fresh')];
  const r = revisePlannedTickets(planned, order('same', 'changed', 'later', 'fresh'), existing);
  assert.deepEqual(keys(r.rebuild), ['changed']);
  assert.deepEqual(keys(r.restart), ['later']);
  assert.deepEqual(keys(r.drop), ['gone']);
  assert.deepEqual(r.keep.map((k) => k.ticket.key), ['same', 'changed', 'later']);
});

test('a built ticket stacked on a rebuilt or dropped ticket is rebuilt too, even when its own text is unchanged', () => {
  const existing = [
    row('base', 1, 'approved', 'factory/i/01-base'),
    row('mid', 2, 'approved', 'factory/i/02-mid', { depends_on: ['base'] }),
    row('top', 3, 'in_review', 'factory/i/03-top', { depends_on: ['mid'] }),
    row('dropped', 4, 'approved', 'factory/i/04-dropped'),
    row('above-dropped', 5, 'built', 'factory/i/05-above-dropped', { depends_on: ['dropped'] }),
  ];
  const planned = [spec('base', { title: 'Ticket base, revised' }), spec('mid', { depends_on: ['base'] }), spec('top', { depends_on: ['mid'] }), spec('above-dropped', { depends_on: ['dropped'] })];
  const r = revisePlannedTickets(planned, order('base', 'mid', 'top', 'above-dropped'), existing);
  assert.deepEqual(keys(r.rebuild), ['base', 'mid', 'top', 'above-dropped']);
  assert.deepEqual(keys(r.drop), ['dropped']);
});

test('merged and canceled tickets are never rebuilt or dropped', () => {
  const existing = [row('shipped', 1, 'merged', 'factory/i/01-shipped'), row('old', 2, 'canceled', 'factory/i/02-old')];
  const r = revisePlannedTickets([spec('shipped', { what: 'Reworded after the fact.' })], order('shipped'), existing);
  assert.deepEqual([r.rebuild, r.restart, r.drop], [[], [], []]);
});

test('a ticket whose text differs only in whitespace or dependency order is unchanged', () => {
  const existing = row('a', 1, 'approved', 'factory/i/01-a', { title: 'Ticket  a', what: 'Does\n a.', guidance: [' x '], depends_on: ['b', 'c'] });
  assert.equal(sameSpec(existing, spec('a', { what: 'Does a. ', guidance: ['x'], depends_on: ['c', 'b'] })), true);
  assert.equal(sameSpec(existing, spec('a', { guidance: ['x'], depends_on: ['b', 'c'], what: 'Does b.' })), false);
  assert.equal(sameSpec(existing, spec('a', { guidance: ['x', 'more'], depends_on: ['b', 'c'], what: 'Does a.' })), false);
  assert.equal(sameSpec(existing, spec('a', { guidance: ['x'], depends_on: ['b'], what: 'Does a.' })), false);

  const r = revisePlannedTickets([spec('a', { what: '  Does a.', depends_on: ['c', 'b'] }), spec('b'), spec('c')], order('b', 'c', 'a'), [
    row('b', 1, 'approved', 'factory/i/01-b'),
    row('c', 2, 'approved', 'factory/i/02-c'),
    row('a', 3, 'approved', 'factory/i/03-a', { depends_on: ['b', 'c'] }),
  ]);
  assert.deepEqual([r.rebuild, r.restart, r.drop], [[], [], []]);
});

test('existing tickets keep their numbers and new ones are numbered after the highest', () => {
  const existing = [row('a', 1, 'merged', 'factory/i/01-a'), row('b', 2, 'approved', 'factory/i/02-b'), row('old', 4, 'canceled', null), row('draft', 3, 'proposed', null)];
  const seqs = planTicketSeqs(order('new-1', 'a', 'new-2', 'b'), existing);
  assert.deepEqual([...seqs], [['new-1', 5], ['a', 1], ['new-2', 6], ['b', 2]]);
  assert.deepEqual([...planTicketSeqs(order('x', 'y'), [row('x', 7, 'proposed', null)])], [['x', 1], ['y', 2]], 'a plan not approved yet is numbered afresh');
});

test('a re-plan awaits answers only while its planner’s last word, after the last approval, is BLOCKED', () => {
  const approvedAt = '2026-01-01T10:00:00Z';
  assert.equal(replanAwaitsAnswers({ queuedAt: '2026-01-01T11:00:00Z', verdict: 'PLAN: BLOCKED' }, approvedAt), true);
  assert.equal(replanAwaitsAnswers({ queuedAt: '2026-01-01T09:00:00Z', verdict: 'PLAN: BLOCKED' }, approvedAt), false);
  assert.equal(replanAwaitsAnswers({ queuedAt: '2026-01-01T11:00:00Z', verdict: null }, approvedAt), false);
  assert.equal(replanAwaitsAnswers({ queuedAt: '2026-01-01T11:00:00Z', verdict: 'PLAN: BLOCKED' }, null), false);
  assert.equal(replanAwaitsAnswers(null, approvedAt), false);
});

const valid = { goal: 'A goal long enough', outcome: 'An outcome long enough', guidance: ['Read the code'], acceptance: ['It is done'] };

function planWith(...tickets: PlanTicket[]) {
  return {
    title: 'A revised plan',
    summary: ['First bullet here', 'Second bullet here'],
    goal: 'Return each row entity from the endpoint.',
    success_criteria: ['It works well'],
    definition_of_done: ['Checks pass'],
    test_strategy: ['Unit tests'],
    tickets: tickets.map((t) => ({ ...t, ...valid })),
  };
}

test('a new ticket that reuses a canceled ticket’s key gets the next free key, and its dependents follow it', () => {
  const raw = planWith(spec('kept'), spec('syren', { depends_on: ['kept'] }), spec('after', { depends_on: ['syren'] }));
  const { raw: renamedRaw, renamed } = renameCanceledKeys(raw, new Set(['syren']), new Set(['kept', 'syren', 'syren-2']));
  assert.deepEqual(renamed, [['syren', 'syren-3']]);
  const { plan, order, errors } = validatePlan(renamedRaw, 10);
  assert.deepEqual(errors, []);
  assert.deepEqual(plan!.tickets.map((t) => [t.key, t.depends_on]), [['kept', []], ['syren-3', ['kept']], ['after', ['syren-3']]]);
  assert.deepEqual(order!.map((o) => o.key), ['kept', 'syren-3', 'after']);
  assert.deepEqual(raw.tickets[1].key, 'syren', 'the planner’s plan is not changed in place');
});

test('renaming keeps keys within the 32-character limit and leaves plans without canceled keys alone', () => {
  const long = 'a'.repeat(32);
  const { raw, renamed } = renameCanceledKeys(planWith(spec(long)), new Set([long]), new Set([long]));
  assert.deepEqual(renamed, [[long, `${'a'.repeat(30)}-2`]]);
  assert.deepEqual(validatePlan(raw, 10).errors, []);

  const untouched = planWith(spec('a'), spec('b'));
  assert.equal(renameCanceledKeys(untouched, new Set(['gone']), new Set(['a', 'gone'])).raw, untouched);
  assert.equal(renameCanceledKeys(null, new Set(['gone']), new Set()).raw, null);
});
