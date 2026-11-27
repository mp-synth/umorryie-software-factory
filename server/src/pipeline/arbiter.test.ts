import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Initiative, PlanJson, Run, Ticket } from '@factory/shared';
import {
  arbiterInstructions,
  blockedTicketNeedsArbiter,
  decisionText,
  escalatedReason,
  escalationQuestion,
  planApprovalBlocker,
  readsFeedback,
  renderPlanSituation,
  renderTicketSituation,
  retryStep,
  ticketApprovalBlocker,
  waitingPlanNeedsArbiter,
  waitsForOwner,
} from './arbiter.ts';

const init = (status: Initiative['status']) => ({ status });
const ticket = (status: Ticket['status']) => ({ status });
const stopped = (kind: Run['kind'], status: Run['status'] = 'succeeded') => ({ kind, status, round: 2, verdict: null, error: null });

test('a plan waits for the owner when it needs approval, answers or a fresh start', () => {
  for (const status of ['awaiting_approval', 'needs_input', 'failed'] as const) assert.equal(waitsForOwner(init(status), null), true, status);
  for (const status of ['draft', 'planning', 'plan_review', 'in_progress', 'done', 'archived'] as const) assert.equal(waitsForOwner(init(status), null), false, status);
});

test('a ticket waits for the owner only when blocked in a live initiative', () => {
  assert.equal(waitsForOwner(init('in_progress'), ticket('blocked')), true);
  assert.equal(waitsForOwner(init('done'), ticket('blocked')), true);
  assert.equal(waitsForOwner(init('archived'), ticket('blocked')), false);
  assert.equal(waitsForOwner(init('in_progress'), ticket('changes_requested')), false);
  assert.equal(waitsForOwner(init('awaiting_approval'), ticket('blocked')), false);
});

test('startup re-arms a blocked ticket only when work stopped after its latest arbiter decision', () => {
  const run = (queuedAt: string, verdict: string | null = null, finishedAt: string | null = queuedAt) => ({ queuedAt, finishedAt, verdict });
  const blockedTicket = ticket('blocked');
  const stopped = run('2026-01-01T10:10:00Z');
  assert.equal(blockedTicketNeedsArbiter(blockedTicket, stopped, null, false), true);
  assert.equal(blockedTicketNeedsArbiter(blockedTicket, stopped, run('2026-01-01T10:00:00Z'), true), true);
  assert.equal(blockedTicketNeedsArbiter(blockedTicket, stopped, run('2026-01-01T10:20:00Z', 'DECISION: RETRY'), true), true);
  assert.equal(blockedTicketNeedsArbiter(blockedTicket, stopped, run('2026-01-01T10:20:00Z', 'DECISION: ESCALATE'), false), true);
  assert.equal(blockedTicketNeedsArbiter(blockedTicket, stopped, run('2026-01-01T10:20:00Z', 'DECISION: ESCALATE'), true), false);
  assert.equal(blockedTicketNeedsArbiter(ticket('approved'), stopped, null, false), false);
  assert.equal(blockedTicketNeedsArbiter(blockedTicket, null, null, false), false);
});

test('startup re-arms a waiting plan unless its latest escalation was applied', () => {
  const run = (queuedAt: string, verdict: string | null = null) => ({ queuedAt, finishedAt: queuedAt, verdict });
  const stopped = run('2026-01-01T10:10:00Z');
  assert.equal(waitingPlanNeedsArbiter(init('needs_input'), stopped, null, false), true);
  assert.equal(waitingPlanNeedsArbiter(init('failed'), stopped, run('2026-01-01T10:20:00Z', 'DECISION: RETRY'), true), true);
  assert.equal(waitingPlanNeedsArbiter(init('awaiting_approval'), stopped, run('2026-01-01T10:20:00Z', 'DECISION: ESCALATE'), false), true);
  assert.equal(waitingPlanNeedsArbiter(init('awaiting_approval'), stopped, run('2026-01-01T10:20:00Z', 'DECISION: ESCALATE'), true), false);
  assert.equal(waitingPlanNeedsArbiter(init('in_progress'), stopped, null, false), false);
});

test('a failed step runs again; a finished one goes to a builder or a fixer', () => {
  assert.equal(retryStep(stopped('review', 'failed')), 'review');
  assert.equal(retryStep(stopped('verify', 'interrupted')), 'verify');
  assert.equal(retryStep(stopped('execute')), 'execute');
  for (const kind of ['gate', 'review', 'fix', 'verify'] as const) assert.equal(retryStep(stopped(kind)), 'fix', kind);
  assert.equal(retryStep(null), 'execute');
});

test('only the planner, the executor and the fixer read instructions as feedback', () => {
  assert.deepEqual(
    (['plan', 'plan_review', 'execute', 'gate', 'review', 'fix', 'verify'] as const).filter(readsFeedback),
    ['plan', 'execute', 'fix'],
  );
});

test('a ticket can be approved only with commits, a worktree, passing checks and no unverified fix', () => {
  const branch = (commitsAhead: number | null, unverifiedFix = false) => ({ commitsAhead, unverifiedFix });
  assert.equal(ticketApprovalBlocker({ branch: 'b', gateStatus: 'pass' }, branch(2)), null);
  assert.equal(ticketApprovalBlocker({ branch: 'b', gateStatus: null }, branch(1)), null);
  assert.equal(ticketApprovalBlocker({ branch: null, gateStatus: null }, branch(null)), 'nothing is committed on the branch');
  assert.equal(ticketApprovalBlocker({ branch: 'b', gateStatus: 'pass' }, branch(0)), 'nothing is committed on the branch');
  assert.equal(ticketApprovalBlocker({ branch: 'b', gateStatus: 'pass' }, branch(null)), 'the branch has no local worktree to check');
  assert.equal(ticketApprovalBlocker({ branch: 'b', gateStatus: 'fail' }, branch(3)), 'the checks fail');
  assert.equal(ticketApprovalBlocker({ branch: 'b', gateStatus: 'pass' }, branch(3, true)), 'a fix on the branch has not been verified');
});

const planJson = { title: 't', tickets: [] } as unknown as PlanJson;

test('a plan can be approved only when it is valid and waiting for approval', () => {
  assert.equal(planApprovalBlocker({ status: 'awaiting_approval', planJson }), null);
  assert.equal(planApprovalBlocker({ status: 'awaiting_approval', planJson: null }), 'there is no valid plan yet');
  assert.equal(planApprovalBlocker({ status: 'failed', planJson }), 'there is no valid plan yet');
  assert.equal(planApprovalBlocker({ status: 'needs_input', planJson }), 'the planner is waiting for answers, not approval');
});

const decision = `DECISION: RETRY

## Reason
\`src/a.ts:3\` already returns 409.

## Instructions
1. Drop finding R3.1.
`;

test('decisionText reads the sections the owner and the next agent need', () => {
  assert.deepEqual(decisionText(decision), { reason: '`src/a.ts:3` already returns 409.', instructions: '1. Drop finding R3.1.', question: '' });
  assert.deepEqual(decisionText('DECISION: ESCALATE\n\n## Question\nUse prod keys? Recommended: no.'), { reason: '', instructions: '', question: 'Use prod keys? Recommended: no.' });
});

test('the instructions message leads with the reason and keeps the instructions whole', () => {
  assert.equal(arbiterInstructions('Arbiter sent the plan back', decisionText(decision)), '**Arbiter sent the plan back.** `src/a.ts:3` already returns 409.\n\n1. Drop finding R3.1.');
  assert.equal(arbiterInstructions('Retry', { reason: '', instructions: '', question: '' }), '**Retry.**');
});

test('the question for the owner explains an approval the arbiter was not allowed to make', () => {
  const text = { reason: 'Findings are nits.', instructions: '', question: '' };
  assert.equal(escalationQuestion('APPROVE', text, 'the checks fail'), 'The arbiter would approve it, but the checks fail. Findings are nits.');
  assert.equal(escalationQuestion('ESCALATE', { ...text, question: 'Which region?' }, null), 'Which region?');
  assert.equal(escalationQuestion('ESCALATE', text, null), 'Findings are nits.');
  assert.equal(escalationQuestion('ESCALATE', { reason: '', instructions: '', question: '' }, null), 'The arbiter could not decide.');
});

test('the escalated reason puts the question first and stays within the column limit', () => {
  assert.equal(escalatedReason('Which region?', 'Checks still fail after round 5.'), 'Which region?\n\nStopped because: Checks still fail after round 5.');
  assert.equal(escalatedReason('  ', null), 'The arbiter could not decide.');
  assert.equal(escalatedReason('q', 'x'.repeat(3000)).length, 2000);
});

const plan = (over: Partial<Initiative> = {}) => ({ status: 'awaiting_approval' as const, planRound: 2, planJson, planMd: 'PLAN: READY', ...over });

test('the plan situation says why it waits and what each decision would do', () => {
  const ready = renderPlanSituation({ init: plan(), maxPlanRounds: 3, reviewVerdict: 'PASS', failure: null });
  assert.match(ready, /Plan round 2 waits for the owner's approval\. The plan review says PASS\./);
  assert.match(ready, /- APPROVE: the plan is approved, its tickets are created/);
  assert.match(ready, /- RETRY: a fresh planner revises the plan/);
  const exhausted = renderPlanSituation({ init: plan({ planRound: 3 }), maxPlanRounds: 3, reviewVerdict: 'REVISE', failure: null });
  assert.match(exhausted, /The plan review says REVISE after 3 rounds, the limit\./);
  assert.match(renderPlanSituation({ init: plan(), maxPlanRounds: 3, reviewVerdict: null, failure: null }), /The plan was not reviewed\./);
});

test('the plan situation shows the planner questions and offers no approval for them', () => {
  const md = 'PLAN: BLOCKED\n\n## Blocked\n1. Soft delete? Recommended: yes.\n';
  const out = renderPlanSituation({ init: plan({ status: 'needs_input', planMd: md }), maxPlanRounds: 3, reviewVerdict: null, failure: null });
  assert.match(out, /blocked on these questions:\n\n1\. Soft delete\? Recommended: yes\./);
  assert.match(out, /- APPROVE: not available: the planner is waiting for answers, not approval\./);
  assert.match(out, /Answer every question, by number\./);
  assert.match(renderPlanSituation({ init: plan({ status: 'failed', planJson: null }), maxPlanRounds: 3, reviewVerdict: null, failure: 'timed out' }), /Planning failed: timed out\./);
});

const blocked = { blockedReason: 'Review still asks for changes after 5 rounds.', round: 5, gateStatus: 'pass' as const, lastVerdict: 'CHANGES', branch: 'b', prUrl: 'https://github.com/o/r/pull/9' };

test('the ticket situation names the stopped step and what a retry would run', () => {
  const out = renderTicketSituation({ ticket: blocked, stopped: { ...stopped('review'), verdict: 'VERDICT: CHANGES' }, maxRounds: 5, approveBlocker: null });
  assert.match(out, /Why it stopped: Review still asks for changes after 5 rounds\./);
  assert.match(out, /Last step: reviewer, round 2: succeeded, VERDICT: CHANGES\./);
  assert.match(out, /Round 5 of 5\. Checks: pass\. Last review: CHANGES\./);
  assert.match(out, /PR: https:\/\/github\.com\/o\/r\/pull\/9/);
  assert.match(out, /- APPROVE: the ticket is marked approved/);
  assert.match(out, /- RETRY: a fresh fixer runs with your Instructions as the owner's binding feedback\./);
});

test('the ticket situation explains an unavailable approval and a retry that reads no feedback', () => {
  const out = renderTicketSituation({ ticket: blocked, stopped: { ...stopped('verify', 'failed'), error: 'timed out' }, maxRounds: 5, approveBlocker: 'the checks fail' });
  assert.match(out, /- APPROVE: not available: the checks fail\./);
  assert.match(out, /- RETRY: a fresh fix verifier runs again; your Instructions are recorded for the owner\./);
  assert.match(out, /Last step: fix verifier, round 2: failed, timed out\./);
});
