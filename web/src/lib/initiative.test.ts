import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_INITIATIVE_SETTINGS, type InitiativeDetail, type InitiativeSummary, type PlanJson, type Run, type Ticket } from '@factory/shared';
import { inboxItems, initiativeSignal, nextStep, progressSegments, sidebarGroup, stagesFor } from './initiative';

const PLAN = { goal: 'Ship it', summary: [], tickets: [] } as unknown as PlanJson;

function ticket(seq: number, status: Ticket['status'], extra: Partial<Ticket> = {}): Ticket {
  return { id: `t${seq}`, key: `k${seq}`, seq, wave: 0, status, dependsOn: [], branch: null, ...extra } as Ticket;
}

function run(id: string, kind: Run['kind'], status: Run['status'], extra: Partial<Run> = {}): Run {
  return { id, kind, status, ticketId: null, round: 1, queuedAt: '2026-11-25T00:00:00Z', startedAt: '2026-11-25T00:00:00Z', ...extra } as Run;
}

function detail({ status = 'in_progress', approved = true, plan = PLAN, tickets = [], runs = [] }: { status?: InitiativeDetail['initiative']['status']; approved?: boolean; plan?: PlanJson | null; tickets?: Ticket[]; runs?: Run[] } = {}): InitiativeDetail {
  return {
    initiative: { id: 'i1', kind: 'feature', status, planJson: plan, approvedAt: approved ? '2026-11-25T00:00:00Z' : null, planRound: 1, settings: DEFAULT_INITIATIVE_SETTINGS },
    project: { name: 'app', repoPath: '/Users/me/workspace/app' },
    tickets,
    runs,
    messages: [],
    costUsd: 0,
  } as unknown as InitiativeDetail;
}

describe('nextStep', () => {
  it('says who is planning and that nothing is needed yet', () => {
    const step = nextStep(detail({ status: 'planning', approved: false, plan: null, runs: [run('p', 'plan', 'running')] }));
    assert.equal(step.title, 'The planner is reading app and writing the plan.');
    assert.equal(step.needsYou, false);
    assert.equal(step.live, true);
    assert.deepEqual(step.action, { kind: 'watch', label: 'Watch live', runId: 'p' });
  });

  it('asks for the plan approval, and for answers to the planner', () => {
    assert.equal(nextStep(detail({ status: 'awaiting_approval', approved: false })).action?.kind, 'review-plan');
    const questions = nextStep(detail({ status: 'needs_input', approved: false }));
    assert.equal(questions.needsYou, true);
    assert.equal(questions.action?.kind, 'answer');
  });

  it('puts stopped tickets ahead of agents still working', () => {
    const step = nextStep(detail({ tickets: [ticket(1, 'blocked'), ticket(2, 'building')], runs: [run('e', 'execute', 'running', { ticketId: 't2' })] }));
    assert.equal(step.title, '1 ticket needs you.');
    assert.equal(step.tone, 'bad');
    assert.equal(step.action?.kind, 'show-blocked');
  });

  it('does not count a ticket the arbiter is deciding as one that needs you', () => {
    const step = nextStep(detail({ tickets: [ticket(1, 'blocked')], runs: [run('a', 'arbitrate', 'running', { ticketId: 't1' })] }));
    assert.equal(step.needsYou, false);
    assert.equal(step.title, '1 agent working: an arbiter.');
  });

  it('names the agents at work', () => {
    const step = nextStep(detail({ tickets: [ticket(1, 'building'), ticket(2, 'in_review')], runs: [run('e', 'execute', 'running', { ticketId: 't1' }), run('r', 'review', 'running', { ticketId: 't2' })] }));
    assert.equal(step.title, '2 agents working: an executor, a reviewer.');
    assert.match(step.detail, /^0 of 2 tickets approved/);
  });

  it('reports an idle initiative and what can move', () => {
    const step = nextStep(detail({ tickets: [ticket(1, 'approved'), ticket(2, 'todo')] }));
    assert.equal(step.title, 'Idle: no agent is running.');
    assert.match(step.detail, /1 of 2 tickets approved\. 1 ticket can move/);
  });

  it('calls a done initiative approved until its pull requests merge', () => {
    assert.equal(nextStep(detail({ status: 'done', tickets: [ticket(1, 'approved'), ticket(2, 'merged')] })).title, 'Done: all 2 tickets approved.');
    assert.equal(nextStep(detail({ status: 'done', tickets: [ticket(1, 'merged')] })).title, 'Done: all 1 ticket merged.');
  });

  it('points a finished initiative at the rules its retro proposed', () => {
    const d = { ...detail({ status: 'done', tickets: [ticket(1, 'merged')] }), rules: [{ status: 'proposed' }, { status: 'accepted' }] } as InitiativeDetail;
    const step = nextStep(d);
    assert.deepEqual(step.action, { kind: 'show-rules', label: 'Review 1 learned rule' });
    assert.match(step.detail, /A retro proposed 1 rule for you to accept or reject\.$/);
  });

  it('offers to restore an archived initiative', () => {
    assert.equal(nextStep(detail({ status: 'archived' })).action?.kind, 'restore');
  });
});

describe('stagesFor', () => {
  it('marks the approval as waiting on you before the plan is approved', () => {
    const stages = stagesFor(detail({ status: 'awaiting_approval', approved: false }));
    assert.equal(stages.find((s) => s.key === 'approval')?.state, 'attention');
    assert.equal(stages.find((s) => s.key === 'build')?.state, 'pending');
  });
});

describe('progressSegments', () => {
  it('moves tickets the arbiter is deciding from "need you" to "in flight"', () => {
    const segments = progressSegments({ blocked: 2, building: 1 }, 1);
    assert.equal(segments.find((s) => s.label === 'In flight')?.value, 2);
    assert.equal(segments.find((s) => s.label === 'Need you')?.value, 1);
  });
});

function summary(id: string, status: InitiativeSummary['status'], attention: string | null = null, activeRuns = 0): InitiativeSummary {
  return { id, title: id, status, attention, activeRuns, projectName: 'app' } as InitiativeSummary;
}

describe('sidebar and inbox', () => {
  it('groups initiatives by who needs to act', () => {
    assert.equal(sidebarGroup(summary('a', 'in_progress', '1 ticket blocked', 2)), 'needs-you');
    assert.equal(sidebarGroup(summary('b', 'in_progress', null, 1)), 'working');
    assert.equal(sidebarGroup(summary('c', 'planning')), 'working');
    assert.equal(sidebarGroup(summary('d', 'in_progress')), 'idle');
    assert.equal(sidebarGroup(summary('e', 'done')), 'done');
    assert.equal(sidebarGroup(summary('f', 'archived', 'Planning failed')), null);
  });

  it('lists what waits on the user, stopped tickets first', () => {
    const items = inboxItems([summary('plan', 'awaiting_approval', 'Plan ready for your review'), summary('stuck', 'in_progress', '2 tickets blocked'), summary('fine', 'in_progress')]);
    assert.deepEqual(
      items.map((i) => [i.kind, i.to]),
      [
        ['blocked', '/i/stuck?tab=tickets&show=needs-you'],
        ['approve', '/i/plan?tab=plan'],
      ],
    );
  });

  it('signals a plan to review as a warning and a failure as an error', () => {
    assert.equal(initiativeSignal(summary('a', 'awaiting_approval', 'Plan ready for your review')).tone, 'warn');
    assert.equal(initiativeSignal(summary('b', 'failed', 'Planning failed')).tone, 'bad');
    assert.deepEqual(initiativeSignal(summary('c', 'in_progress', null, 3)), { tone: 'active', live: true, label: '3 agents working' });
  });
});
