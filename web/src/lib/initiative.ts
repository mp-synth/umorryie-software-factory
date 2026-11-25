import type { InitiativeDetail, InitiativeSummary, Run, RunKind, Ticket, TicketStatus } from '@factory/shared';
import type { Segment } from '@/components/ui/feedback';
import type { Tone } from '@/design/tone';
import { findSucceededRun, initiativeStatus, isArbitrating, isNotArchived, isRunInFlight, runKind } from './status';

export type TicketCounts = Partial<Record<TicketStatus, number>>;

const sum = (c: TicketCounts, statuses: TicketStatus[]) => statuses.reduce((a, s) => a + (c[s] ?? 0), 0);

const IN_FLIGHT: TicketStatus[] = ['building', 'checking', 'in_review', 'fixing'];
export const SHIPPED: TicketStatus[] = ['approved', 'merged'];

export function countTickets(tickets: Pick<Ticket, 'status'>[]): TicketCounts {
  const counts: TicketCounts = {};
  for (const t of tickets) counts[t.status] = (counts[t.status] ?? 0) + 1;
  return counts;
}

/** One bar for ticket progress, the same everywhere: shipped, built, in flight, waiting on review, needs you, not started. */
export function progressSegments(c: TicketCounts, arbitrated = 0): Segment[] {
  return [
    { value: c.merged ?? 0, tone: 'good', label: 'Merged' },
    { value: c.approved ?? 0, tone: 'good', label: 'Approved' },
    { value: c.built ?? 0, tone: 'info', label: 'Built' },
    { value: sum(c, IN_FLIGHT) + arbitrated, tone: 'active', label: 'In flight' },
    { value: c.changes_requested ?? 0, tone: 'warn', label: 'Changes requested' },
    { value: (c.blocked ?? 0) - arbitrated, tone: 'bad', label: 'Need you' },
    { value: sum(c, ['todo', 'proposed']), tone: 'muted', label: 'Not started' },
  ];
}

export const shippedCount = (c: TicketCounts) => sum(c, SHIPPED);

export type StageState = 'done' | 'active' | 'attention' | 'pending' | 'skipped' | 'failed';

export interface Stage {
  key: 'plan' | 'plan_review' | 'approval' | 'build' | 'review' | 'fix' | 'ship';
  label: string;
  state: StageState;
  sub?: string;
}

export function stagesFor(d: InitiativeDetail): Stage[] {
  const { initiative: i, tickets, runs, messages } = d;
  const c = countTickets(tickets);
  const total = tickets.filter((t) => t.status !== 'canceled').length;
  const shipped = shippedCount(c);
  const built = tickets.filter((t) => !['proposed', 'todo', 'building', 'canceled'].includes(t.status)).length;
  const fixRuns = runs.filter((r) => r.kind === 'fix' && r.status === 'succeeded').length;
  const approved = !!i.approvedAt;
  const arbiterOnPlan = isArbitrating(runs.filter((r) => !r.ticketId));
  const approvedByArbiter = approved && messages.some((m) => m.kind === 'approval' && m.author === 'agent' && !m.ticketId);
  const progress = (active: boolean, doneCount: number): StageState =>
    !approved ? 'pending' : active ? 'active' : total > 0 && doneCount === total ? 'done' : doneCount > 0 ? 'active' : 'pending';

  const plan: StageState =
    i.status === 'planning' ? 'active' : i.status === 'failed' ? 'failed' : i.status === 'needs_input' ? 'attention' : i.planJson ? 'done' : 'pending';
  const review: StageState =
    i.status === 'plan_review' ? 'active' : findSucceededRun(runs, 'plan_review') ? 'done' : i.planJson && !i.settings.autoPlanReview ? 'skipped' : 'pending';
  const approval: StageState = approved ? 'done' : arbiterOnPlan ? 'active' : ['awaiting_approval', 'needs_input'].includes(i.status) ? 'attention' : 'pending';
  const fix: StageState = !approved
    ? 'pending'
    : (c.fixing ?? 0) > 0
      ? 'active'
      : sum(c, ['blocked', 'changes_requested']) > 0
        ? 'attention'
        : fixRuns > 0
          ? 'done'
          : 'pending';

  return [
    { key: 'plan', label: 'Plan', state: plan, sub: i.planRound ? `round ${i.planRound}` : undefined },
    { key: 'plan_review', label: 'Plan review', state: review },
    { key: 'approval', label: 'Approval', state: approval, sub: arbiterOnPlan ? 'arbiter deciding' : approvedByArbiter ? 'by the arbiter' : undefined },
    { key: 'build', label: 'Build', state: progress(sum(c, ['building', 'checking']) > 0, built), sub: approved ? `${built}/${total}` : undefined },
    { key: 'review', label: 'Review', state: progress((c.in_review ?? 0) > 0, shipped), sub: approved ? `${shipped}/${total}` : undefined },
    { key: 'fix', label: 'Fix', state: fix, sub: fixRuns ? `${fixRuns} round${fixRuns > 1 ? 's' : ''}` : undefined },
    { key: 'ship', label: 'Ship', state: i.status === 'done' ? 'done' : shipped > 0 ? 'active' : 'pending', sub: c.merged ? `${c.merged} merged` : shipped ? `${shipped} ready` : undefined },
  ];
}

export type NextActionKind = 'start-planning' | 'review-plan' | 'answer' | 'show-blocked' | 'show-tickets' | 'show-rules' | 'watch' | 'restore' | 'open-run' | 'copy-report';

export interface NextAction {
  kind: NextActionKind;
  label: string;
  runId?: string;
}

/** What is happening on an initiative, in one sentence, and the one thing to do about it. */
export interface NextStep {
  tone: Tone;
  title: string;
  detail: string;
  live: boolean;
  needsYou: boolean;
  action?: NextAction;
}

const PLAN_STEPS: RunKind[] = ['plan', 'plan_review', 'arbitrate'];

export const activePlanRun = (runs: Run[]): Run | undefined => runs.find((r) => !r.ticketId && PLAN_STEPS.includes(r.kind) && isRunInFlight(r));

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const article = (word: string) => (/^[aeiou]/.test(word) ? 'an' : 'a');

function agentList(runs: Run[]): string {
  const counts = new Map<string, number>();
  for (const r of runs) counts.set(runKind[r.kind].agent.toLowerCase(), (counts.get(runKind[r.kind].agent.toLowerCase()) ?? 0) + 1);
  return [...counts].map(([agent, n]) => (n > 1 ? `${n} ${agent}s` : `${article(agent)} ${agent}`)).join(', ');
}

export function nextStep(d: InitiativeDetail): NextStep {
  const { initiative: i, tickets, runs, project } = d;
  const repo = project.repoPath.split('/').pop() ?? project.name;
  const planRun = activePlanRun(runs);
  const live = runs.filter((r) => r.status === 'running');
  const queued = runs.filter((r) => r.status === 'queued');
  const watch = (run: Run, label = 'Watch live'): NextAction => ({ kind: 'watch', label, runId: run.id });

  if (i.status === 'archived') {
    return { tone: 'muted', title: 'This initiative is archived.', detail: 'It is hidden from the overview and the sidebar. Restore it to pick up where it left off.', live: false, needsYou: false, action: { kind: 'restore', label: 'Restore' } };
  }
  if (planRun) {
    const waiting = planRun.status === 'queued';
    const title = waiting
      ? `The ${runKind[planRun.kind].agent.toLowerCase()} is waiting for a free agent slot.`
      : planRun.kind === 'plan'
        ? `The planner is reading ${repo} and writing the plan.`
        : planRun.kind === 'plan_review'
          ? 'A reviewer is checking the plan against the code.'
          : 'The arbiter is deciding on the plan for you.';
    const detail =
      planRun.kind === 'arbitrate'
        ? 'It approves the plan, answers the planner or sends it back. You only get what it cannot decide.'
        : 'Nothing is needed from you yet. You see the plan before any code is written.';
    return { tone: 'active', title, detail, live: !waiting, needsYou: false, action: watch(planRun) };
  }
  if (i.status === 'needs_input') {
    return { tone: 'warn', title: 'The planner needs answers from you.', detail: 'Answer its questions below. A fresh planner continues from your answers.', live: false, needsYou: true, action: { kind: 'answer', label: 'Answer questions' } };
  }
  if (i.status === 'awaiting_approval') {
    return {
      tone: 'warn',
      title: 'Your call: the plan is ready.',
      detail: 'Read the overview, then approve it or ask for changes. Nothing is built until you approve.',
      live: false,
      needsYou: true,
      action: { kind: 'review-plan', label: 'Review the plan' },
    };
  }
  if (i.status === 'failed') {
    const last = runs.find((r) => r.kind === 'plan' && r.status === 'failed');
    return {
      tone: 'bad',
      title: 'Planning failed.',
      detail: 'Open the last run to see what went wrong, then start planning again.',
      live: false,
      needsYou: true,
      action: last ? { kind: 'open-run', label: 'Open the failed run', runId: last.id } : { kind: 'start-planning', label: 'Start planning' },
    };
  }
  if (i.kind !== 'open-prs' && !i.planJson && !i.approvedAt) {
    return { tone: 'neutral', title: 'Not started yet.', detail: 'Start planning when the brief is ready. A fresh planner reads the repository first.', live: false, needsYou: false, action: { kind: 'start-planning', label: 'Start planning' } };
  }

  const c = countTickets(tickets);
  const total = tickets.filter((t) => t.status !== 'canceled').length;
  const shipped = shippedCount(c);
  const arbitrated = tickets.filter((t) => t.status === 'blocked' && isArbitrating(runs.filter((r) => r.ticketId === t.id))).length;
  const blocked = (c.blocked ?? 0) - arbitrated;
  const progress = `${shipped} of ${plural(total, 'ticket')} approved`;
  const proposed = (d.rules ?? []).filter((r) => r.status === 'proposed').length;
  const rules = proposed ? ` A retro proposed ${plural(proposed, 'rule')} for you to accept or reject.` : '';
  const rulesAction = (otherwise: NextAction): NextAction => (proposed ? { kind: 'show-rules', label: `Review ${plural(proposed, 'learned rule')}` } : otherwise);

  if (blocked > 0) {
    return {
      tone: 'bad',
      title: `${plural(blocked, 'ticket')} ${blocked === 1 ? 'needs' : 'need'} you.`,
      detail: `${blocked === 1 ? 'It' : 'They'} stopped and will not continue on ${blocked === 1 ? 'its' : 'their'} own. Open ${blocked === 1 ? 'it' : 'them'} to see why. ${progress}.`,
      live: live.length > 0,
      needsYou: true,
      action: { kind: 'show-blocked', label: blocked === 1 ? 'Show the ticket' : 'Show the tickets' },
    };
  }
  if (i.status === 'done' || (total > 0 && shipped === total)) {
    const merged = c.merged ?? 0;
    const all = merged === total ? `all ${plural(total, 'ticket')} merged` : `all ${plural(total, 'ticket')} approved`;
    return {
      tone: 'good',
      title: i.status === 'done' ? `Done: ${all}.` : `${all.charAt(0).toUpperCase()}${all.slice(1)}.`,
      detail: `${merged === total ? 'Every pull request is merged.' : merged ? `${merged} merged, ${total - merged} approved and ready to merge.` : 'None merged yet: every pull request is approved and ready to merge.'}${rules}`,
      live: live.length > 0,
      needsYou: false,
      action: rulesAction({ kind: 'copy-report', label: 'Copy report' }),
    };
  }
  if (live.length > 0) {
    return {
      tone: 'active',
      title: `${plural(live.length, 'agent')} working: ${agentList(live)}.`,
      detail: `${progress}${queued.length ? `, ${queued.length} more waiting for a slot` : ''}. Nothing is needed from you right now.`,
      live: true,
      needsYou: false,
      action: watch(live[live.length - 1], 'Watch the agents'),
    };
  }
  if (queued.length > 0) {
    return { tone: 'active', title: `${plural(queued.length, 'agent')} waiting for a free slot.`, detail: `${progress}. They start as soon as the pool has room.`, live: false, needsYou: false, action: watch(queued[0]) };
  }
  const waiting = sum(c, ['todo', 'built', 'changes_requested']);
  return {
    tone: 'neutral',
    title: 'Idle: no agent is running.',
    detail: `${waiting ? `${progress}. ${plural(waiting, 'ticket')} can move: autopilot starts them when they are ready, or use the ticket actions.` : `${progress}. Waiting on pull requests and CI.`}${rules}`,
    live: false,
    needsYou: false,
    action: rulesAction({ kind: 'show-tickets', label: 'Show tickets' }),
  };
}

/** The one signal a list row shows for an initiative: what needs you beats who is working beats its status. */
export function initiativeSignal(i: InitiativeSummary): { tone: Tone; live: boolean; label: string } {
  if (i.attention) return { tone: i.status === 'awaiting_approval' || i.status === 'needs_input' ? 'warn' : 'bad', live: false, label: i.attention };
  if (i.activeRuns > 0) return { tone: 'active', live: true, label: `${plural(i.activeRuns, 'agent')} working` };
  const s = initiativeStatus[i.status];
  return { tone: s.tone === 'accent' ? 'neutral' : s.tone, live: !!s.live, label: s.label };
}

export type SidebarGroup = 'needs-you' | 'working' | 'idle' | 'done';

/** The sidebar sorts initiatives the way Claude Code sorts sessions: who needs you, who is working, then the rest. */
export function sidebarGroup(i: InitiativeSummary): SidebarGroup | null {
  if (!isNotArchived(i)) return null;
  if (i.attention) return 'needs-you';
  if (i.activeRuns > 0 || ['planning', 'plan_review'].includes(i.status)) return 'working';
  if (i.status === 'done') return 'done';
  return 'idle';
}

export type InboxKind = 'approve' | 'questions' | 'failed' | 'blocked';

export interface InboxItem {
  kind: InboxKind;
  initiative: InitiativeSummary;
  title: string;
  detail: string;
  cta: string;
  to: string;
  tone: Tone;
}

const INBOX_ORDER: InboxKind[] = ['blocked', 'questions', 'approve', 'failed'];

/** Everything waiting on the user across initiatives, most urgent first. */
export function inboxItems(initiatives: InitiativeSummary[]): InboxItem[] {
  const items: InboxItem[] = [];
  for (const i of initiatives) {
    if (!isNotArchived(i) || !i.attention) continue;
    const base = { initiative: i, title: i.title };
    if (i.status === 'awaiting_approval') {
      items.push({ ...base, kind: 'approve', detail: 'The plan is ready for your review. Nothing is built until you approve it.', cta: 'Review plan', to: `/i/${i.id}?tab=plan`, tone: 'warn' });
    } else if (i.status === 'needs_input') {
      items.push({ ...base, kind: 'questions', detail: 'The planner has questions only you can answer.', cta: 'Answer', to: `/i/${i.id}?tab=plan`, tone: 'warn' });
    } else if (i.status === 'failed') {
      items.push({ ...base, kind: 'failed', detail: 'Planning failed. See what went wrong and start again.', cta: 'Open', to: `/i/${i.id}`, tone: 'bad' });
    } else {
      items.push({ ...base, kind: 'blocked', detail: `${i.attention}. They stopped and wait for you.`, cta: 'Show tickets', to: `/i/${i.id}?tab=tickets&show=needs-you`, tone: 'bad' });
    }
  }
  return items.sort((a, b) => INBOX_ORDER.indexOf(a.kind) - INBOX_ORDER.indexOf(b.kind));
}
