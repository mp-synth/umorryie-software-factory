// Types and constants shared by the server and the web UI.

export type Model = 'opus' | 'sonnet' | 'haiku';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const INITIATIVE_STATUSES = [
  'draft',
  'planning',
  'plan_review',
  'needs_input',
  'awaiting_approval',
  'in_progress',
  'done',
  'failed',
  'archived',
] as const;
export type InitiativeStatus = (typeof INITIATIVE_STATUSES)[number];

export const TICKET_STATUSES = [
  'proposed', // in a plan that is not approved yet
  'todo', // approved, waiting for dependencies or a manual start
  'building', // executor queued or running
  'checking', // gate (checks command) queued or running
  'built', // committed and checked, waiting for review
  'in_review', // reviewer queued or running
  'changes_requested', // review said CHANGES or the gate failed
  'fixing', // fixer queued or running
  'approved', // reviewer approved: ready to merge
  'merged', // PR merged (seen by "Sync PRs")
  'blocked', // an agent reported BLOCKED or rounds ran out: needs a human
  'canceled',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const RUN_KINDS = ['plan', 'plan_review', 'execute', 'gate', 'review', 'fix', 'ask'] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'canceled', 'interrupted'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export interface InitiativeSettings {
  /** Run the plan reviewer automatically after every plan. */
  autoPlanReview: boolean;
  /** After approval, start tickets as soon as their dependencies allow. */
  autoExecute: boolean;
  /** Review a branch as soon as it is built and checked. */
  autoReview: boolean;
  /** Fix automatically when a review asks for changes or checks fail. */
  autoFix: boolean;
  /** Push branches and open draft PRs (requires a GitHub `origin`). */
  createPrs: boolean;
  /** Post every review as a PR comment. */
  postReviewsToPr: boolean;
  /** Build → review → fix rounds per ticket before a human is asked. */
  maxRounds: number;
  /** Planner ↔ plan-reviewer rounds before the plan goes to you anyway. */
  maxPlanRounds: number;
  /** Tickets of this initiative that may have an agent running at once. */
  concurrency: number;
  /** Most tickets the planner may create. */
  maxTickets: number;
  models: Record<Exclude<RunKind, 'gate'>, Model> & { mechanicalFix: Model };
}

export const DEFAULT_INITIATIVE_SETTINGS: InitiativeSettings = {
  autoPlanReview: true,
  autoExecute: true,
  autoReview: true,
  autoFix: true,
  createPrs: true,
  postReviewsToPr: false,
  maxRounds: 3,
  maxPlanRounds: 2,
  concurrency: 2,
  maxTickets: 10,
  models: {
    plan: 'opus',
    plan_review: 'opus',
    execute: 'opus',
    review: 'opus',
    fix: 'opus',
    mechanicalFix: 'sonnet',
    ask: 'sonnet',
  },
};

export interface AppSettings {
  /** Agents (and gates) running at once across every initiative. */
  maxConcurrentAgents: number;
  /** Hard stop for a single agent run, in minutes. */
  runTimeoutMinutes: number;
  /** Optional per-run spend cap passed to `claude --max-budget-usd`. */
  maxBudgetUsdPerRun: number | null;
  /** Load your user-level Claude settings (hooks, plugins) into agents. Off keeps agents clean. */
  loadUserSettings: boolean;
  /** Timeout for the checks command, in minutes. */
  gateTimeoutMinutes: number;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  maxConcurrentAgents: 4,
  runTimeoutMinutes: 60,
  maxBudgetUsdPerRun: null,
  loadUserSettings: false,
  gateTimeoutMinutes: 20,
};

export interface Project {
  id: string;
  name: string;
  repoPath: string;
  defaultBranch: string;
  checksCommand: string | null;
  setupCommand: string | null;
  notes: string | null;
  remoteUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanTicket {
  key: string;
  title: string;
  what: string;
  goal: string;
  outcome: string;
  guidance: string[];
  acceptance: string[];
  depends_on: string[];
  size: 'XS' | 'S' | 'M';
}

/** The structured half of a plan (plan.json). plan.md holds the long form. */
export interface PlanJson {
  title: string;
  summary: string[];
  goal: string;
  success_criteria: string[];
  definition_of_done: string[];
  edge_cases: string[];
  test_strategy: string[];
  risks: string[];
  out_of_scope: string[];
  assumptions: string[];
  tickets: PlanTicket[];
}

export interface Initiative {
  id: string;
  projectId: string;
  slug: string;
  title: string;
  brief: string;
  baseBranch: string;
  status: InitiativeStatus;
  planRound: number;
  planMd: string | null;
  planJson: PlanJson | null;
  planVerdict: string | null;
  settings: InitiativeSettings;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Ticket {
  id: string;
  initiativeId: string;
  key: string;
  seq: number;
  wave: number;
  title: string;
  what: string;
  goal: string;
  outcome: string;
  guidance: string[];
  acceptance: string[];
  dependsOn: string[];
  size: string | null;
  status: TicketStatus;
  round: number;
  branch: string | null;
  baseRef: string | null;
  worktreePath: string | null;
  prNumber: number | null;
  prUrl: string | null;
  prState: string | null;
  lastVerdict: string | null;
  gateStatus: 'pass' | 'fail' | 'skipped' | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  initiativeId: string;
  ticketId: string | null;
  kind: RunKind;
  round: number;
  status: RunStatus;
  trigger: 'auto' | 'manual';
  model: string | null;
  effort: string | null;
  prompt: string | null;
  cwd: string | null;
  runDir: string | null;
  outputPath: string | null;
  outputMd: string | null;
  verdict: string | null;
  summary: string | null;
  sessionId: string | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  numTurns: number | null;
  error: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  // joined for lists
  initiativeTitle?: string;
  ticketTitle?: string | null;
  ticketSeq?: number | null;
}

export type RunEventType = 'init' | 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'result' | 'stderr' | 'system' | 'log';

export interface RunEvent {
  id: string;
  runId: string;
  ts: string;
  type: RunEventType;
  data: Record<string, unknown>;
}

export interface Message {
  id: string;
  initiativeId: string;
  ticketId: string | null;
  runId: string | null;
  author: 'human' | 'agent' | 'system';
  kind: 'comment' | 'feedback' | 'question' | 'answer' | 'approval' | 'event';
  body: string;
  consumedByRun: string | null;
  createdAt: string;
}

export interface InitiativeSummary extends Initiative {
  projectName: string;
  repoPath: string;
  ticketCounts: Partial<Record<TicketStatus, number>>;
  ticketTotal: number;
  activeRuns: number;
  costUsd: number;
  attention: string | null;
}

export interface InitiativeDetail {
  initiative: Initiative;
  project: Project;
  tickets: Ticket[];
  runs: Run[];
  messages: Message[];
  costUsd: number;
}

export type ChangeEvent = {
  type: 'project' | 'initiative' | 'ticket' | 'run' | 'message' | 'settings';
  id: string;
  initiativeId?: string | null;
};

export interface Health {
  db: boolean;
  claude: { ok: boolean; path: string | null; version: string | null };
  gh: { ok: boolean; user: string | null };
  home: string;
}

/** Ticket statuses that count as finished for progress and dependency purposes. */
export const DONE_TICKET_STATUSES: TicketStatus[] = ['approved', 'merged'];
export const ACTIVE_TICKET_STATUSES: TicketStatus[] = ['building', 'checking', 'in_review', 'fixing'];
