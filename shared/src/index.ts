export const MODELS = ['fable', 'opus', 'sonnet', 'haiku'] as const;
export type Model = (typeof MODELS)[number];
/** The exact Claude version each model name runs. Agents always get the 1M context window on top. */
export const MODEL_VERSIONS: Record<Model, { id: string; label: string }> = {
  fable: { id: 'claude-fable-5-2', label: 'Fable 5.2' },
  opus: { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  sonnet: { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  haiku: { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
};
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
  'proposed',
  'todo',
  'building',
  'checking',
  'built',
  'in_review',
  'changes_requested',
  'fixing',
  'approved',
  'merged',
  'blocked',
  'canceled',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const RUN_KINDS = ['plan', 'plan_review', 'execute', 'gate', 'review', 'fix', 'verify', 'arbitrate', 'ask', 'steer', 'retro'] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export const SIDE_RUN_KINDS: readonly RunKind[] = ['ask', 'retro'];
export const isSideRun = (kind: RunKind): boolean => SIDE_RUN_KINDS.includes(kind);

export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'canceled', 'interrupted'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export interface InitiativeSettings {
  autoPlanReview: boolean;
  autoExecute: boolean;
  autoReview: boolean;
  autoFix: boolean;
  createPrs: boolean;
  postReviewsToPr: boolean;
  dependentsWaitForCi: boolean;
  autoArbiter: boolean;
  autoMerge: boolean;
  autoRetro: boolean;
  maxRounds: number;
  maxPlanRounds: number;
  maxArbiterDecisions: number;
  concurrency: number;
  maxTickets: number;
  models: Record<Exclude<RunKind, 'gate'>, Model> & { mechanicalFix: Model };
}

export const DEFAULT_INITIATIVE_SETTINGS: InitiativeSettings = {
  autoPlanReview: true,
  autoExecute: true,
  autoReview: true,
  autoFix: true,
  createPrs: true,
  postReviewsToPr: true,
  dependentsWaitForCi: false,
  autoArbiter: true,
  autoMerge: false,
  autoRetro: true,
  maxRounds: 5,
  maxPlanRounds: 3,
  maxArbiterDecisions: 3,
  concurrency: 4,
  maxTickets: 10,
  models: {
    plan: 'opus',
    plan_review: 'opus',
    execute: 'opus',
    review: 'opus',
    fix: 'opus',
    mechanicalFix: 'sonnet',
    verify: 'opus',
    arbitrate: 'fable',
    ask: 'sonnet',
    steer: 'opus',
    retro: 'opus',
  },
};

export interface AppSettings {
  autoScaleAgents: boolean;
  maxConcurrentAgents: number;
  runTimeoutMinutes: number;
  maxBudgetUsdPerRun: number | null;
  loadUserSettings: boolean;
  gateTimeoutMinutes: number;
  sweepOpenPrs: boolean;
  resumeInterruptedRuns: boolean;
  prNoiseCommentAuthors: string[];
}

export const MAX_MANUAL_AGENTS = 200;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoScaleAgents: true,
  maxConcurrentAgents: 12,
  runTimeoutMinutes: 60,
  maxBudgetUsdPerRun: null,
  loadUserSettings: false,
  gateTimeoutMinutes: 20,
  sweepOpenPrs: true,
  resumeInterruptedRuns: true,
  prNoiseCommentAuthors: ['github-actions', 'alwaysmeticulous', 'codecov', 'codecov-commenter', 'sonarqubecloud', 'sonarcloud', 'vercel', 'netlify', 'linear'],
};

export const PR_SWEEP_INTERVAL_MINUTES = 15;
export const PR_SWEEP_CLAIM_MINUTES = 45;

export interface Project {
  id: string;
  name: string;
  repoPath: string;
  defaultBranch: string;
  checksCommand: string | null;
  setupCommand: string | null;
  notes: string | null;
  remoteUrl: string | null;
  copyFiles: string[];
  referenceDirs: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DirEntry {
  name: string;
  path: string;
  git: boolean;
}

export interface BrowseResult {
  path: string;
  parent: string | null;
  home: string;
  entries: DirEntry[];
}

export interface EnvironmentSuggestion {
  source: 'files' | 'claude';
  setupCommand: string | null;
  checksCommand: string | null;
  copyFiles: string[];
  referenceDirs: string[];
  prerequisites: string[];
  evidence: string[];
  costUsd?: number | null;
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

export type InitiativeKind = 'feature' | 'open-prs';

export interface Initiative {
  id: string;
  projectId: string;
  kind: InitiativeKind;
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
  prHeadRef: string | null;
  prStack: number | null;
  ciState?: 'green' | 'red' | 'pending' | 'none' | null;
  ciHeadSha?: string | null;
  linesChanged?: number | null;
  lastVerdict: string | null;
  gateStatus: 'pass' | 'fail' | 'skipped' | null;
  blockedReason: string | null;
  prSweepClaimedAt: string | null;
  prSweepFingerprint: string | null;
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
  roleSha?: string | null;
  claudeVersion?: string | null;
  factorySha?: string | null;
  baseSha?: string | null;
  headSha?: string | null;
  crashRequeues?: number;
  error: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
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

export const RULE_SCOPES = ['project', 'factory'] as const;
export type RuleScope = (typeof RULE_SCOPES)[number];

export const RULE_ROLES = ['all', 'code', 'writing', 'planner', 'plan-reviewer', 'executor', 'reviewer', 'fixer', 'verifier', 'arbiter'] as const;
export type RuleRole = (typeof RULE_ROLES)[number];

export type RuleStatus = 'proposed' | 'accepted' | 'rejected' | 'retired';

export interface Rule {
  id: string;
  projectId: string;
  initiativeId: string | null;
  ticketId: string | null;
  runId: string | null;
  scope: RuleScope;
  role: RuleRole;
  body: string;
  why: string;
  status: RuleStatus;
  createdAt: string;
  decidedAt: string | null;
}

export interface InitiativeDetail {
  initiative: Initiative;
  project: Project;
  tickets: Ticket[];
  runs: Run[];
  messages: Message[];
  rules?: Rule[];
  costUsd: number;
}

export type ChangeEvent = {
  type: 'project' | 'initiative' | 'ticket' | 'run' | 'message' | 'settings';
  id: string;
  initiativeId?: string | null;
};

export type MachinePressure = 'ok' | 'load' | 'memory';

export interface CapacityStatus {
  autoScale: boolean;
  limit: number;
  ceiling: number;
  running: number;
  queued: number;
  lanes: number;
  localWorkSlots: number;
  cores: number;
  memoryGb: number;
  loadPerCore: number;
  pressure: MachinePressure;
}

export interface Health {
  db: boolean;
  claude: { ok: boolean; path: string | null; version: string | null };
  gh: { ok: boolean; user: string | null };
  home: string;
}

export const DONE_TICKET_STATUSES: TicketStatus[] = ['approved', 'merged'];
export const ACTIVE_TICKET_STATUSES: TicketStatus[] = ['building', 'checking', 'in_review', 'fixing'];

export const SIZE_BUDGETS: Record<string, number> = { XS: 50, S: 200, M: 500 };
const SIZE_OVERRUN = 1.5;

export function overSizeBudget(size: string | null | undefined, linesChanged: number | null | undefined): boolean {
  const budget = size ? SIZE_BUDGETS[size] : undefined;
  return budget !== undefined && linesChanged != null && linesChanged > budget * SIZE_OVERRUN;
}
