import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Ticket } from '@factory/shared';
import { parseRestacks, parseRoutes, renderTicketsForSteering, resolveTicketRef, routeBlocker, routeReason, routesByTicket } from './steer.ts';

const ticket = (seq: number, key: string, status: Ticket['status'] = 'approved', extra: Partial<Ticket> = {}) =>
  ({ id: `id-${key}`, seq, key, title: `Ticket ${key}`, status, branch: `factory/x/${key}`, worktreePath: `/wt/${key}`, prUrl: `https://github.com/o/r/pull/${seq}`, prState: 'OPEN', dependsOn: [], what: 'Does a thing.', baseRef: 'main', ...extra }) as Ticket;

const route = `ROUTE: TICKETS

## Reason
Naming lives in 01, the retry in 03.

## Ticket api-client
1. Rename \`fetchAll\` to \`listAll\` (\`src/api.ts:12\`).

## Ticket 03-retry
1. Retry twice, not five times.
`;

test('routes are read per ticket heading', () => {
  assert.deepEqual(parseRoutes(route), [
    { ref: 'api-client', instructions: '1. Rename `fetchAll` to `listAll` (`src/api.ts:12`).' },
    { ref: '03-retry', instructions: '1. Retry twice, not five times.' },
  ]);
  assert.equal(routeReason(route), 'Naming lives in 01, the retry in 03.');
  assert.deepEqual(parseRoutes('ROUTE: NONE\n\n## Reason\nAll merged.'), []);
});

test('a route finds its ticket by key, folder name or number', () => {
  const tickets = [ticket(1, 'api-client'), ticket(3, 'retry')];
  assert.equal(resolveTicketRef('api-client', tickets)?.seq, 1);
  assert.equal(resolveTicketRef('`03-retry`', tickets)?.seq, 3);
  assert.equal(resolveTicketRef('[03] Retry', tickets)?.seq, 3);
  assert.equal(resolveTicketRef('retry (key retry)', tickets)?.seq, 3);
  assert.equal(resolveTicketRef('unknown', tickets), null);
});

test('two sections for one ticket reach it as one set of instructions, and unknown refs are reported', () => {
  const tickets = [ticket(1, 'api-client'), ticket(3, 'retry')];
  const { routed, unknownRefs } = routesByTicket(
    [
      { ref: 'api-client', instructions: '1. Rename `fetchAll`.' },
      { ref: 'nowhere', instructions: '1. Lost.' },
      { ref: '01-api-client', instructions: '1. Drop the debug log.' },
      { ref: 'retry', instructions: '1. Retry twice.' },
    ],
    tickets,
  );
  assert.deepEqual(
    routed.map((r) => [r.ticket.key, r.instructions]),
    [
      ['api-client', '1. Rename `fetchAll`.\n\n1. Drop the debug log.'],
      ['retry', '1. Retry twice.'],
    ],
  );
  assert.deepEqual(unknownRefs, ['nowhere']);
});

test('merged, canceled and unapproved tickets take no changes', () => {
  assert.equal(routeBlocker({ status: 'merged' }), 'it is merged');
  assert.equal(routeBlocker({ status: 'canceled' }), 'it is canceled');
  assert.equal(routeBlocker({ status: 'proposed' }), 'it is proposed');
  for (const status of ['todo', 'built', 'approved', 'blocked', 'changes_requested'] as const) assert.equal(routeBlocker({ status }), null, status);
});

test('the ticket list shows the stack, the diff and what can take changes', () => {
  const md = renderTicketsForSteering(
    [ticket(1, 'api-client', 'merged'), ticket(2, 'retry', 'approved', { dependsOn: ['api-client'], baseRef: 'factory/x/api-client' })],
    'main',
  );
  assert.match(md, /Status: merged \(can't take changes: it is merged\)/);
  assert.match(md, /Builds on: \[01\] Ticket api-client \(key api-client\)/);
  assert.match(md, /git -C \/wt\/retry diff factory\/x\/api-client\.\.\.HEAD/);
  assert.match(md, /Builds on: `main`/);
  assert.match(md, /git -C \/wt\/api-client diff origin\/main\.\.\.HEAD/);
});

test('reads restacks of open tickets onto other open tickets and refuses the impossible ones', () => {
  const t = (seq: number, key: string, dependsOn: string[], status: Ticket['status'] = 'approved') => ({ id: key, key, seq, title: key, status, dependsOn });
  const tickets = [t(1, 'core', []), t(5, 'create', ['core']), t(7, 'update', ['core']), t(9, 'renew', ['core']), t(3, 'gone', [], 'merged')];
  const md = [
    'ROUTE: TICKETS',
    '',
    '## Restack',
    '- update onto create',
    '- [09] renew onto 05',
    '- create onto update',
    '- core onto create',
    '- update onto gone',
    '- nope onto create',
    '',
    '## Ticket create',
    'Define the term helpers here.',
  ].join('\n');
  const { restacks, rejected } = parseRestacks(md, tickets);
  assert.deepEqual(restacks.map((r) => `${r.ticket.key}>${r.onto.key}`), ['update>create', 'renew>create']);
  assert.equal(rejected.length, 4);
  assert.match(rejected[0], /already builds on/);
  assert.match(rejected[1], /already builds on/);
  assert.match(rejected[2], /merged/);
  assert.match(rejected[3], /no such ticket/);
  assert.deepEqual(parseRoutes(md).map((r) => r.ref), ['create']);
});
