export const MODELS = ['fable', 'opus', 'sonnet', 'haiku'] as const;
export type Model = (typeof MODELS)[number];
/** The exact Claude version each model name runs. Agents always get the 1M context window on top. */
export const MODEL_VERSIONS: Record<Model, { id: string; label: string }> = {
  fable: { id: 'claude-fable-5-2', label: 'Fable 5.2' },
  opus: { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  sonnet: { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  haiku: { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
};
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

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

export type GatePurpose = 'readiness' | 'sync' | 'repair' | 'publish';

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
  /**
   * Start a ticket once the ticket it stacks on is built and its PR is open, instead of once that
   * ticket is approved. Its review still waits until the ticket below is approved.
   */
  dependentsStartWhenBuilt: boolean;
  autoArbiter: boolean;
  autoMerge: boolean;
  autoRetro: boolean;
  /**
   * A ticket the plan marks as a foundation (the contract others build on) holds its dependents until it is
   * approved and its CI is green, so a late change to it never travels up a built stack.
   */
  foundationCheckpoint: boolean;
  /**
   * Every PR lands in one GitHub stack in plan order: tickets still build side by side when what they need is
   * ready and their write sets don't overlap, and each PR opens on the one before it once that one is open.
   */
  lineInPlanOrder: boolean;
  /** Auto-merge lands the approved, green bottom of a stack in one merge instead of one PR at a time. */
  landStackAtOnce: boolean;
  /** A fix round on a ticket whose previous fix round succeeded continues that agent's session instead of re-reading the repo. */
  resumeFixSessions: boolean;
  maxRounds: number;
  maxPlanRounds: number;
  maxArbiterDecisions: number;
  concurrency: number;
  maxTickets: number;
  models: Record<AgentRunKind, Model> & { mechanicalFix: Model };
  /** Effort per step where it differs from the factory's default, for comparing a cheaper setting on real work. */
  efforts: Partial<Record<AgentRunKind, Effort>>;
}

export type AgentRunKind = Exclude<RunKind, 'gate'>;

export const DEFAULT_INITIATIVE_SETTINGS: InitiativeSettings = {
  autoPlanReview: true,
  autoExecute: true,
  autoReview: true,
  autoFix: true,
  createPrs: true,
  postReviewsToPr: true,
  dependentsWaitForCi: false,
  dependentsStartWhenBuilt: true,
  autoArbiter: true,
  autoMerge: false,
  autoRetro: true,
  foundationCheckpoint: true,
  lineInPlanOrder: false,
  landStackAtOnce: false,
  resumeFixSessions: false,
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
  efforts: {},
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
  /** Keep the Mac awake while steps run, so a sleep never kills a healthy run as timed out. */
  keepAwake: boolean;
  /** On battery below this percentage no new agent starts; running ones finish. 0 turns it off. */
  minBatteryPercent: number;
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
  prNoiseCommentAuthors: ['github-actions', 'alwaysmeticulous', 'meticulous', 'codecov', 'codecov-commenter', 'sonarqubecloud', 'sonarcloud', 'vercel', 'netlify', 'linear'],
  keepAwake: true,
  minBatteryPercent: 15,
};

/**
 * must-fix: always fixed (lint, generated specs, tests), whatever branch protection says. fix: fixed when it
 * fails. people-only: only people turn it green (a code-owner review, a visual diff). ignore: never acted on.
 * waiting-on: fails because of work outside this repo (a backend contract not published yet); no fixer.
 */
export const CHECK_CLASSES = ['must-fix', 'fix', 'people-only', 'ignore', 'waiting-on'] as const;
export type CheckClass = (typeof CHECK_CLASSES)[number];

export interface CheckRule {
  /** A regular expression matched against the check's name. */
  pattern: string;
  class: CheckClass;
  /** When set, the rule applies only when the failed job's log matches this regular expression. */
  logPattern?: string;
  /** Shown on the ticket when the rule keeps a fixer away. */
  note?: string;
}

function quotedPolicyPattern(text: string): { value: string; rest: string } | null {
  if (!text.startsWith('"')) return null;
  for (let i = 1; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
    } else if (text[i] === '"') {
      try {
        return { value: JSON.parse(text.slice(0, i + 1)), rest: text.slice(i + 1) };
      } catch {
        return null;
      }
    }
  }
  return null;
}

function quotedPolicyRule(text: string): Pick<CheckRule, 'pattern' | 'logPattern' | 'note'> | null {
  const parsedPattern = quotedPolicyPattern(text);
  if (!parsedPattern) return null;
  let rest = parsedPattern.rest;
  let logPattern: string | undefined;
  if (rest.startsWith(' when ')) {
    const parsedLog = quotedPolicyPattern(rest.slice(6));
    if (!parsedLog) return null;
    logPattern = parsedLog.value;
    rest = parsedLog.rest;
  }
  if (rest && !rest.startsWith(' :: ')) return null;
  const note = rest.slice(4) || undefined;
  return { pattern: parsedPattern.value, ...(logPattern ? { logPattern } : {}), ...(note ? { note } : {}) };
}

/** One rule per line: `<class> <name pattern> [when <log pattern>] [:: <note>]`, e.g. `people-only ^Meticulous :: a visual diff`. */
export function parseCheckPolicy(text: string): { rules: CheckRule[]; errors: string[] } {
  const rules: CheckRule[] = [];
  const errors: string[] = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const space = line.search(/\s/);
    const cls = space < 0 ? line : line.slice(0, space);
    const quoted = space < 0 ? null : quotedPolicyRule(line.slice(space).trimStart());
    if ((CHECK_CLASSES as readonly string[]).includes(cls) && quoted) {
      rules.push({ class: cls as CheckClass, ...quoted });
      return;
    }
    const [body, note] = line.split(/\s+::\s+/, 2);
    const [head, logPattern] = body.split(/\s+when\s+/, 2);
    const [legacyClass, ...pattern] = head.split(/\s+/);
    if (!(CHECK_CLASSES as readonly string[]).includes(legacyClass) || !pattern.length) {
      errors.push(`line ${i + 1}: start with one of ${CHECK_CLASSES.join(', ')}, then the check name pattern`);
      return;
    }
    rules.push({ class: legacyClass as CheckClass, pattern: pattern.join(' '), ...(logPattern ? { logPattern } : {}), ...(note ? { note } : {}) });
  });
  return { rules, errors };
}

export function formatCheckPolicy(rules: CheckRule[]): string {
  return rules
    .map((r) => {
      const quotePatterns = [r.pattern, r.logPattern, r.note].some((part) => part?.includes(' when ') || part?.includes(' :: '));
      const pattern = quotePatterns ? JSON.stringify(r.pattern) : r.pattern;
      const logPattern = r.logPattern ? `when ${quotePatterns ? JSON.stringify(r.logPattern) : r.logPattern}` : '';
      return [r.class, pattern, logPattern, r.note ? `:: ${r.note}` : ''].filter(Boolean).join(' ');
    })
    .join('\n');
}

export const PR_SWEEP_INTERVAL_MINUTES = 15;
export const PR_SWEEP_CLAIM_MINUTES = 45;

export interface Project {
  id: string;
  name: string;
  repoPath: string;
  defaultBranch: string;
  checksCommand: string | null;
  setupCommand: string | null;
  /** Autofixers the server runs on a branch before its checks (formatters, lint autofix, generated specs); the server commits what changed. */
  fixCommand: string | null;
  /** A fast check the server runs after it merges the PR below (or the base branch) into a branch, before it pushes that merge. */
  mergeCheckCommand: string | null;
  /** What agents may run to check their own work (lint and types on changed files); the gate runs the full checks command. */
  quickChecksCommand: string | null;
  /** How the PR sweep treats each failing check; the factory's defaults apply to checks no rule names. */
  checkPolicy: CheckRule[];
  /** Paths (globs) of generated files: a merge conflict only in these is resolved by regenerating them. */
  generatedPaths: string[];
  /** Agents' commits skip the repo's commit hooks; the gate runs the checks once instead of on every commit. */
  skipAgentCommitHooks: boolean;
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
  /** Files and folders the ticket creates or edits; `generated:` marks generated files, which don't count as overlap. */
  touches?: string[];
  /** The contract other tickets build on: its dependents wait until it is approved and green. */
  foundation?: boolean;
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
  /** The one ticket this ticket stacks on (empty for none): its branch and PR sit on that ticket's. */
  dependsOn: string[];
  /** What the ticket needs from other tickets, as the planner wrote it; `dependsOn` is derived from it. */
  needs: string[];
  /** Files and folders the plan says the ticket creates or edits. */
  touches?: string[];
  foundation?: boolean;
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
  /** Whether the open PR is still a draft, as of the last PR sync; null until the first sync after it opened. */
  prDraft?: boolean | null;
  ciState?: 'green' | 'red' | 'pending' | 'none' | null;
  ciHeadSha?: string | null;
  linesChanged?: number | null;
  lastVerdict: string | null;
  gateStatus: 'pass' | 'fail' | 'skipped' | 'infra' | 'waiting' | null;
  blockedReason: string | null;
  prSweepClaimedAt: string | null;
  prSweepFingerprint: string | null;
  /** Why the last PR sweep that looked at this open PR started no fixer; null once one starts. */
  prSweepSkip?: PrSweepSkip | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * idle: nothing to fix. ci-running: CI has not finished. merge-unknown: GitHub has not worked out
 * whether the PR merges. already-tried: a fixer already had the PR in this exact state.
 */
export type PrSweepSkipReason = 'idle' | 'ci-running' | 'merge-unknown' | 'already-tried' | 'inherited' | 'rerun' | 'waiting-on' | 'stack-below';

export interface PrSweepSkip {
  /** When the sweep first found the PR in this state. */
  since: string;
  headSha: string;
  reason: PrSweepSkipReason;
  /** One sentence on why no fixer started. */
  why: string;
  /** What only people can move, such as a code-owner review or a visual-diff approval. */
  waitingOn: string[];
  /** What the sweep dropped before handing the PR to a fixer. */
  ignored: string[];
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
  /** For a gate: the tree it checked and a digest of the commands, so an identical tree reuses its result. */
  treeSha?: string | null;
  /** Why a gate outside the build and fix rounds runs, and the status its ticket returns to. */
  gatePurpose?: GatePurpose | null;
  gateRestingStatus?: TicketStatus | null;
  checksDigest?: string | null;
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
  type: 'project' | 'initiative' | 'ticket' | 'run' | 'message' | 'settings' | 'usage';
  id: string;
  initiativeId?: string | null;
};

/** Tokens one agent session sent and received, as billed: cache writes and reads are separate prices. */
export interface UsageTokens {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

/**
 * One agent session in the usage ledger. It outlives its run: resetting or deleting an
 * initiative removes runs, never the money they spent.
 */
export interface UsageSession {
  sessionId: string;
  runId: string | null;
  initiativeId: string | null;
  kind: string;
  label: string | null;
  model: string | null;
  effort: string | null;
  startedAt: string;
  finishedAt: string | null;
  requests: number;
  tokens: UsageTokens;
  costUsd: number;
  /** What the claude CLI itself reported, when it got to report (a killed agent reports nothing). */
  reportedCostUsd: number | null;
  /** 'transcript': priced from every API response in the session's transcript; 'cli': only the CLI's own total was available. */
  pricedFrom: 'transcript' | 'cli';
  runStatus: string | null;
  verdict: string | null;
}

export interface UsageBucket {
  key: string;
  costUsd: number;
  sessions: number;
}

export interface UsageSummary {
  from: string;
  to: string;
  costUsd: number;
  sessions: number;
  tokens: UsageTokens;
  /** One entry per UTC day in the range, empty days included. */
  byDay: UsageBucket[];
  byKind: UsageBucket[];
  byModel: UsageBucket[];
}

export interface UsageWeek {
  /** Monday 00:00 UTC. */
  weekStart: string;
  costUsd: number;
  sessions: number;
}

export type MachinePressure = 'ok' | 'load' | 'memory';

export interface CapacityStatus {
  /** Why no new agent starts right now (signed out of Claude, a usage limit, low battery), or null. */
  paused: string | null;
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
/** A ticket whose PR waits on GitHub: the PR sweep looks at these on its own. */
export const SETTLED_TICKET_STATUSES: TicketStatus[] = ['built', 'changes_requested', 'approved'];

export const SIZE_BUDGETS: Record<string, number> = { XS: 50, S: 200, M: 500 };
const SIZE_OVERRUN = 1.5;

export function overSizeBudget(size: string | null | undefined, linesChanged: number | null | undefined): boolean {
  const budget = size ? SIZE_BUDGETS[size] : undefined;
  return budget !== undefined && linesChanged != null && linesChanged > budget * SIZE_OVERRUN;
}
