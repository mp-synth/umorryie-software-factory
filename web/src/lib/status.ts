import {
  BrainCircuit,
  ClipboardCheck,
  GraduationCap,
  Hammer,
  MessageCircleQuestion,
  Route,
  Scale,
  ScanSearch,
  ShieldCheck,
  UserCheck,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { InitiativeStatus, RunKind, RunStatus, TicketStatus } from '@factory/shared';
import type { Hue, Tone } from '@/design/tone';

export interface StatusInfo {
  label: string;
  tone: Tone;
  live?: boolean;
  /** One plain sentence on what the status means, for tooltips and legends. */
  description: string;
}

export const initiativeStatus: Record<InitiativeStatus, StatusInfo> = {
  draft: { label: 'Draft', tone: 'neutral', description: 'Not started. Planning starts when you press Start planning.' },
  planning: { label: 'Planning', tone: 'active', live: true, description: 'A planner is reading the repository and writing the plan.' },
  plan_review: { label: 'Reviewing plan', tone: 'active', live: true, description: 'A second agent is checking the plan against the code.' },
  needs_input: { label: 'Needs your input', tone: 'warn', description: 'The planner has questions only you can answer.' },
  awaiting_approval: { label: 'Awaiting approval', tone: 'warn', description: 'The plan is ready: approve it, or ask for changes.' },
  in_progress: { label: 'Building', tone: 'accent', description: 'Agents are building, checking, reviewing and fixing the tickets.' },
  done: { label: 'Done', tone: 'good', description: 'Every ticket is approved or merged.' },
  failed: { label: 'Failed', tone: 'bad', description: 'Planning failed. Open the last run to see why, then try again.' },
  archived: { label: 'Archived', tone: 'muted', description: 'Put away. Restore it to continue.' },
};

export const ticketStatus: Record<TicketStatus, StatusInfo> = {
  proposed: { label: 'Proposed', tone: 'muted', description: 'Part of a plan that is not approved yet.' },
  todo: { label: 'To do', tone: 'neutral', description: 'Waiting to be built.' },
  building: { label: 'Building', tone: 'active', live: true, description: 'An executor is writing the code in its own worktree.' },
  checking: { label: 'Running checks', tone: 'active', live: true, description: "The project's checks command is running on the branch." },
  built: { label: 'Built', tone: 'info', description: 'Built and checked, waiting for a review.' },
  in_review: { label: 'In review', tone: 'active', live: true, description: 'A reviewer with no memory of the build is reading the diff.' },
  changes_requested: { label: 'Changes requested', tone: 'warn', description: 'The review found things to fix.' },
  fixing: { label: 'Fixing', tone: 'active', live: true, description: 'A fixer is working through findings, failing CI and PR comments.' },
  approved: { label: 'Approved', tone: 'good', description: 'Reviewed and approved.' },
  merged: { label: 'Merged', tone: 'good', description: 'Its pull request is merged.' },
  blocked: { label: 'Needs you', tone: 'bad', description: 'Stopped until you act. Open the ticket to see why.' },
  canceled: { label: 'Canceled', tone: 'muted', description: 'A revised plan no longer needs it.' },
};

export const runStatus: Record<RunStatus, StatusInfo> = {
  queued: { label: 'Queued', tone: 'neutral', description: 'Waiting for a free agent slot.' },
  running: { label: 'Running', tone: 'active', live: true, description: 'Working now.' },
  succeeded: { label: 'Done', tone: 'good', description: 'Finished.' },
  failed: { label: 'Failed', tone: 'bad', description: 'Ended with an error.' },
  canceled: { label: 'Canceled', tone: 'muted', description: 'Stopped before it finished.' },
  interrupted: { label: 'Interrupted', tone: 'warn', description: 'A restart stopped it.' },
};

export interface AgentKind {
  label: string;
  agent: string;
  icon: LucideIcon;
  hue: Hue;
  description: string;
}

export const runKind: Record<RunKind, AgentKind> = {
  plan: { label: 'Plan', agent: 'Planner', icon: BrainCircuit, hue: 'info', description: 'Reads the repository and writes the plan and its tickets.' },
  plan_review: { label: 'Plan review', agent: 'Plan reviewer', icon: ClipboardCheck, hue: 'info', description: 'Checks the plan against the code before you see it.' },
  execute: { label: 'Build', agent: 'Executor', icon: Hammer, hue: 'accent', description: 'Writes the code for one ticket on its own branch.' },
  gate: { label: 'Checks', agent: 'Checks gate', icon: ShieldCheck, hue: 'neutral', description: "Runs the project's checks command. No agent involved." },
  review: { label: 'Review', agent: 'Reviewer', icon: ScanSearch, hue: 'pink', description: 'Reads the diff with fresh eyes and approves or asks for changes.' },
  fix: { label: 'Fix', agent: 'Fixer', icon: Wrench, hue: 'orange', description: 'Fixes review findings, failing CI, conflicts and PR comments.' },
  verify: { label: 'Verify fix', agent: 'Fix verifier', icon: UserCheck, hue: 'lime', description: 'Checks that a fix did what it says.' },
  arbitrate: { label: 'Decide', agent: 'Arbiter', icon: Scale, hue: 'yellow', description: 'Decides for you when a step would otherwise wait on you.' },
  ask: { label: 'Ask', agent: 'Advisor', icon: MessageCircleQuestion, hue: 'active', description: 'Answers your questions about the plan and the code.' },
  steer: { label: 'Route feedback', agent: 'Steering router', icon: Route, hue: 'orange', description: 'Sends your feedback to the pull requests it belongs to.' },
  retro: { label: 'Retro', agent: 'Retro', icon: GraduationCap, hue: 'good', description: 'Learns rules from what you had to steer by hand.' },
};

export function verdictTone(v: string | null | undefined): Tone {
  if (!v) return 'muted';
  if (/SKIPPED/i.test(v)) return 'neutral';
  if (/APPROVE|PASS|READY|APPLIED/i.test(v)) return 'good';
  if (/CHANGES|REVISE|NO-CHANGES|NOTHING|RETRY/i.test(v)) return 'warn';
  if (/BLOCK|FAIL|ESCALATE/i.test(v)) return 'bad';
  return 'neutral';
}

export function shortVerdict(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.replace(/^(VERDICT|STATUS|PLAN|FIX|GATE|DECISION|ROUTE|RETRO):\s*/i, '').split(/\s+·\s+/)[0].slice(0, 28);
}

export const isRunInFlight = (r: { status: RunStatus }): boolean => r.status === 'running' || r.status === 'queued';

export const isArbitrating = (runs: { kind: RunKind; status: RunStatus }[]): boolean => runs.some((r) => r.kind === 'arbitrate' && isRunInFlight(r));

type ReplaceableRun = { id: string; kind: RunKind; status: RunStatus; ticketId: string | null; queuedAt: string; startedAt: string | null };

/** Ids of failed or interrupted runs that a later run of the same agent, on the same ticket, has replaced. */
export function replacedRunIds(runs: ReplaceableRun[]): Set<string> {
  const scope = (r: ReplaceableRun) => `${r.ticketId ?? ''}:${r.kind}`;
  const at = (r: ReplaceableRun) => Date.parse(r.startedAt ?? r.queuedAt);
  const latest = new Map<string, number>();
  for (const r of runs) latest.set(scope(r), Math.max(latest.get(scope(r)) ?? -Infinity, at(r)));
  return new Set(runs.filter((r) => (r.status === 'failed' || r.status === 'interrupted') && latest.get(scope(r))! > at(r)).map((r) => r.id));
}

export const isNotArchived = (i: { status: InitiativeStatus }): boolean => i.status !== 'archived';

export const findSucceededRun = <R extends { kind: RunKind; status: RunStatus }>(runs: R[], kind: RunKind): R | undefined =>
  runs.find((r) => r.kind === kind && r.status === 'succeeded');
