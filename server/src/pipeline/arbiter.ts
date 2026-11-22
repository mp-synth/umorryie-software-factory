import type { Initiative, InitiativeStatus, Run, RunKind, Ticket } from '@factory/shared';
import { section } from './plan.ts';

export type Decision = 'APPROVE' | 'RETRY' | 'ESCALATE';

const PLAN_STATUSES_WAITING_FOR_OWNER: InitiativeStatus[] = ['awaiting_approval', 'needs_input', 'failed'];
const INITIATIVES_WITH_LIVE_TICKETS: InitiativeStatus[] = ['in_progress', 'done'];
const STEPS_THAT_READ_FEEDBACK: RunKind[] = ['plan', 'execute', 'fix'];

const AGENT_NAMES: Partial<Record<RunKind, string>> = {
  plan: 'planner',
  plan_review: 'plan reviewer',
  execute: 'executor',
  gate: 'checks run',
  review: 'reviewer',
  fix: 'fixer',
  verify: 'fix verifier',
  arbitrate: 'arbiter',
  ask: 'advisor',
  steer: 'steering router',
  retro: 'retro',
};

export function agentName(kind: RunKind): string {
  return AGENT_NAMES[kind] ?? kind;
}

export function waitsForOwner(init: Pick<Initiative, 'status'>, ticket: Pick<Ticket, 'status'> | null): boolean {
  if (!ticket) return PLAN_STATUSES_WAITING_FOR_OWNER.includes(init.status);
  return ticket.status === 'blocked' && INITIATIVES_WITH_LIVE_TICKETS.includes(init.status);
}

export function retryStep(stopped: Pick<Run, 'kind' | 'status'> | null): RunKind {
  if (!stopped) return 'execute';
  if (stopped.status !== 'succeeded') return stopped.kind;
  return stopped.kind === 'execute' ? 'execute' : 'fix';
}

export function readsFeedback(kind: RunKind): boolean {
  return STEPS_THAT_READ_FEEDBACK.includes(kind);
}

export interface BranchState {
  commitsAhead: number | null;
  unverifiedFix: boolean;
}

export function ticketApprovalBlocker(ticket: Pick<Ticket, 'branch' | 'gateStatus'>, branch: BranchState): string | null {
  if (!ticket.branch || branch.commitsAhead === 0) return 'nothing is committed on the branch';
  if (branch.commitsAhead === null) return 'the branch has no local worktree to check';
  if (ticket.gateStatus === 'fail') return 'the checks fail';
  if (branch.unverifiedFix) return 'a fix on the branch has not been verified';
  return null;
}

export function planApprovalBlocker(init: Pick<Initiative, 'status' | 'planJson'>): string | null {
  if (init.status === 'needs_input') return 'the planner is waiting for answers, not approval';
  if (init.status !== 'awaiting_approval' || !init.planJson) return 'there is no valid plan yet';
  return null;
}

export interface DecisionText {
  reason: string;
  instructions: string;
  question: string;
}

export function decisionText(md: string): DecisionText {
  return {
    reason: section(md, 'Reason') ?? '',
    instructions: section(md, 'Instructions') ?? '',
    question: section(md, 'Question') ?? '',
  };
}

export function arbiterInstructions(title: string, text: DecisionText): string {
  return [`**${title}.** ${text.reason}`.trim(), text.instructions].filter(Boolean).join('\n\n');
}

export function escalationQuestion(decision: Decision, text: DecisionText, approveBlocker: string | null): string {
  if (decision === 'APPROVE') return `The arbiter would approve it, but ${approveBlocker}. ${text.reason}`.trim();
  return text.question || text.reason || 'The arbiter could not decide.';
}

function decisionList(approve: string, retry: string): string[] {
  return ['## What each decision does', '', `- APPROVE: ${approve}`, `- RETRY: ${retry}`, '- ESCALATE: it waits for the owner with your Question.'];
}

export interface PlanSituation {
  init: Pick<Initiative, 'status' | 'planRound' | 'planJson' | 'planMd'>;
  maxPlanRounds: number;
  reviewVerdict: string | null;
  failure: string | null;
}

function planState({ init, maxPlanRounds, reviewVerdict, failure }: PlanSituation): string[] {
  if (init.status === 'needs_input') return ['The planner is blocked on these questions:', '', section(init.planMd ?? '', 'Blocked') ?? init.planMd ?? ''];
  if (init.status === 'failed') return [`Planning failed: ${failure ?? 'no plan was produced'}.`];
  const review = reviewVerdict
    ? `The plan review says ${reviewVerdict}${reviewVerdict !== 'PASS' && init.planRound >= maxPlanRounds ? ` after ${init.planRound} rounds, the limit` : ''}.`
    : 'The plan was not reviewed.';
  return [`Plan round ${init.planRound} waits for the owner's approval. ${review}`];
}

export function renderPlanSituation(s: PlanSituation): string {
  const approveBlocker = planApprovalBlocker(s.init);
  return [
    '# A plan waits for the owner',
    '',
    ...planState(s),
    '',
    ...decisionList(
      approveBlocker ? `not available: ${approveBlocker}.` : 'the plan is approved, its tickets are created and the first wave starts building.',
      s.init.status === 'needs_input'
        ? 'a fresh planner plans again with your Instructions as the owner\'s binding answers. Answer every question, by number.'
        : 'a fresh planner revises the plan with your Instructions as the owner\'s binding feedback.',
    ),
  ].join('\n');
}

export interface TicketSituation {
  ticket: Pick<Ticket, 'blockedReason' | 'round' | 'gateStatus' | 'lastVerdict' | 'branch' | 'prUrl'>;
  stopped: Pick<Run, 'kind' | 'status' | 'round' | 'verdict' | 'error'> | null;
  maxRounds: number;
  approveBlocker: string | null;
}

function stoppedStep(stopped: TicketSituation['stopped']): string {
  if (!stopped) return 'No step has run yet.';
  const outcome = [stopped.status, stopped.verdict, stopped.error].filter(Boolean).join(', ');
  return `Last step: ${agentName(stopped.kind)}, round ${stopped.round}: ${outcome}.`;
}

function retryText(step: RunKind): string {
  const how = readsFeedback(step) ? 'with your Instructions as the owner\'s binding feedback' : 'again; your Instructions are recorded for the owner';
  return `a fresh ${agentName(step)} runs ${how}.`;
}

export function renderTicketSituation(s: TicketSituation): string {
  const { ticket } = s;
  return [
    '# A ticket waits for the owner',
    '',
    `Why it stopped: ${ticket.blockedReason ?? 'not recorded'}`,
    '',
    stoppedStep(s.stopped),
    `Round ${ticket.round} of ${s.maxRounds}. Checks: ${ticket.gateStatus ?? 'not run'}. Last review: ${ticket.lastVerdict ?? 'none'}.`,
    ticket.prUrl ? `PR: ${ticket.prUrl} (a draft until the owner marks it ready).` : 'No PR yet.',
    '',
    ...decisionList(
      s.approveBlocker ? `not available: ${s.approveBlocker}.` : 'the ticket is marked approved and the tickets that depend on it start. Its PR stays a draft for the owner.',
      retryText(retryStep(s.stopped)),
    ),
  ].join('\n');
}

export function escalatedReason(question: string, stoppedBecause: string | null): string {
  return [question.trim() || 'The arbiter could not decide.', stoppedBecause ? `Stopped because: ${stoppedBecause}` : '']
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 2000);
}
