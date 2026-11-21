import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlanJson, TicketStatus } from '@factory/shared';
import { renderReport } from './report.ts';

const planJson = { goal: 'Users can copy a status report in one click.' } as PlanJson;

const ticket = (seq: number, status: TicketStatus, lastVerdict: string | null, prUrl: string | null) => ({
  seq,
  title: `Ticket number ${seq}`,
  status,
  lastVerdict,
  prUrl,
});

test('renderReport renders a planned initiative with mixed tickets', () => {
  const out = renderReport({
    initiative: { title: 'Copy initiative report', planJson },
    tickets: [
      ticket(1, 'approved', 'APPROVE', 'https://github.com/o/r/pull/1'),
      ticket(2, 'changes_requested', 'REQUEST_CHANGES', 'https://github.com/o/r/pull/2'),
      ticket(3, 'todo', null, null),
    ],
    costUsd: 12.3456,
  });
  assert.equal(
    out,
    [
      '# Copy initiative report',
      '',
      'Goal: Users can copy a status report in one click.',
      '',
      '- [01] Ticket number 1 — approved — APPROVE — https://github.com/o/r/pull/1',
      '- [02] Ticket number 2 — changes_requested — REQUEST_CHANGES — https://github.com/o/r/pull/2',
      '- [03] Ticket number 3 — todo — no verdict',
      '',
      'Agent spend: $12.35',
      '',
    ].join('\n'),
  );
});

test('renderReport handles no plan and no tickets', () => {
  const out = renderReport({ initiative: { title: 'Draft idea', planJson: null }, tickets: [], costUsd: 0.0042 });
  assert.equal(out, '# Draft idea\n\nGoal: _no plan yet_\n\n- _No tickets yet._\n\nAgent spend: <$0.01\n');
});

test('renderReport omits the PR link when prUrl is null', () => {
  const out = renderReport({
    initiative: { title: 'T', planJson },
    tickets: [ticket(1, 'in_review', 'APPROVE', null)],
    costUsd: 1,
  });
  assert.equal(out, `# T\n\nGoal: ${planJson.goal}\n\n- [01] Ticket number 1 — in_review — APPROVE\n\nAgent spend: $1.00\n`);
});

test('renderReport shows "no verdict" when lastVerdict is null', () => {
  const out = renderReport({
    initiative: { title: 'T', planJson },
    tickets: [ticket(1, 'building', null, 'https://github.com/o/r/pull/9')],
    costUsd: 1,
  });
  assert.equal(
    out,
    `# T\n\nGoal: ${planJson.goal}\n\n- [01] Ticket number 1 — building — no verdict — https://github.com/o/r/pull/9\n\nAgent spend: $1.00\n`,
  );
});

test('renderReport sorts tickets by seq without mutating input and formats zero spend', () => {
  const tickets = [ticket(2, 'todo', null, null), ticket(1, 'todo', null, null)];
  const out = renderReport({ initiative: { title: 'T', planJson }, tickets, costUsd: 0 });
  assert.equal(
    out,
    [
      '# T',
      '',
      `Goal: ${planJson.goal}`,
      '',
      '- [01] Ticket number 1 — todo — no verdict',
      '- [02] Ticket number 2 — todo — no verdict',
      '',
      'Agent spend: $0.00',
      '',
    ].join('\n'),
  );
  assert.deepEqual(tickets.map((t) => t.seq), [2, 1]);
});

test('renderReport shows <$0.01 for non-zero spend below a cent', () => {
  const spend = (costUsd: number) =>
    renderReport({ initiative: { title: 'T', planJson }, tickets: [], costUsd }).trimEnd().split('\n').at(-1);
  assert.equal(spend(0.0042), 'Agent spend: <$0.01');
  assert.equal(spend(0.0099), 'Agent spend: <$0.01');
  assert.equal(spend(0.01), 'Agent spend: $0.01');
  assert.equal(spend(0), 'Agent spend: $0.00');
});
