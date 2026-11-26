import { createHash } from 'node:crypto';
import { exec } from './git.ts';
import {
  ghEnv,
  humanChecksFrom,
  prSnapshotFrom,
  threadsFrom,
  type AuthorNode,
  type CheckRun,
  type HumanCheck,
  type PrSnapshot,
  type ReviewThread,
  type ThreadNode,
} from './github.ts';

export type GhRunner = (args: string[], input?: string) => Promise<{ code: number; stdout: string; stderr: string }>;

export function ghRunner(cwd: string): GhRunner {
  // A job log runs to several MB, and exec keeps only the last maxOutput bytes.
  return (args, input) => exec('gh', args, { cwd, input, timeoutMs: 60_000, maxOutput: 64_000_000, env: ghEnv() });
}

export interface Repo {
  owner: string;
  name: string;
}

export function repoOf(remoteUrl: string): Repo | null {
  const m = remoteUrl.trim().match(/^(?:https:\/\/(?:[^@/]+@)?|ssh:\/\/git@|git@)(?:www\.)?github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? { owner: m[1], name: m[2] } : null;
}

const PAUSE_BELOW_FRACTION = 0.1;
const FIRST_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;
const REFUSED = /HTTP 429|secondary rate limit|abuse|API rate limit exceeded|RATE_LIMITED|HTTP 403.*(?:rate limit|abuse)|(?:rate limit|abuse).*HTTP 403/i;

const clock = (ms: number) => new Date(ms).toISOString().slice(11, 19);

function createBudget() {
  let rate: { remaining: number; limit: number; resetAt: number } | null = null;
  let refusals = 0;
  let backoffUntil = 0;
  const reasonAt = (now: number): string | null => {
    if (now < backoffUntil) return `GitHub refused a request for rate limiting; no GitHub calls until ${clock(backoffUntil)} UTC`;
    if (rate && rate.remaining < rate.limit * PAUSE_BELOW_FRACTION && now < rate.resetAt) {
      return `only ${rate.remaining} of ${rate.limit} GitHub GraphQL points left; no GitHub calls until the reset at ${clock(rate.resetAt)} UTC`;
    }
    return null;
  };
  return {
    canSpend: (now = Date.now()) => reasonAt(now) === null,
    reason: (now = Date.now()) => reasonAt(now),
    note(reading: { remaining: number; limit: number; resetAt: string }) {
      rate = { remaining: reading.remaining, limit: reading.limit, resetAt: Date.parse(reading.resetAt) || 0 };
      refusals = 0;
    },
    noteRefusal(stderr: string, now = Date.now()) {
      if (!REFUSED.test(stderr)) return;
      backoffUntil = now + Math.min(FIRST_BACKOFF_MS * 2 ** refusals, MAX_BACKOFF_MS);
      refusals++;
    },
    reset() {
      rate = null;
      refusals = 0;
      backoffUntil = 0;
    },
  };
}

/** One budget for every GitHub read in this process: `rateLimit` counts every user of the token, the agents' `gh` calls too. */
export const githubBudget = createBudget();

type Vars = Record<string, string | number | null | undefined>;
interface GraphqlError {
  type?: string;
  message?: string;
}

const RATE_LIMIT = 'rateLimit{cost remaining limit resetAt}';

function parseJson(text: string): { data?: Record<string, unknown> | null; errors?: GraphqlError[] } | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The response's `data`; null when GitHub could not answer, or answered with an error other than a missing PR. */
async function graphql<T>(run: GhRunner, query: string, vars: Vars): Promise<T | null> {
  if (!githubBudget.canSpend()) return null;
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(vars)) {
    if (value === null || value === undefined) continue;
    args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`);
  }
  const r = await run(args);
  const body = parseJson(r.stdout);
  const rate = body?.data?.rateLimit as { remaining: number; limit: number; resetAt: string } | undefined;
  if (rate) githubBudget.note(rate);
  const errors = body?.errors ?? [];
  if (r.code === 0 && !errors.length && body?.data) return body.data as T;
  githubBudget.noteRefusal([r.stderr, ...errors.map((e) => `${e.type ?? ''} ${e.message ?? ''}`)].join('\n'));
  const onlyMissingPrs = errors.length > 0 && errors.every((e) => e.type === 'NOT_FOUND');
  return onlyMissingPrs && body?.data ? (body.data as T) : null;
}

function aliased(numbers: number[], fields: (numberVar: string) => string): { query: string; vars: Vars } {
  for (const n of numbers) if (!Number.isInteger(n) || n <= 0) throw new Error(`not a PR number: ${n}`);
  const vars: Vars = {};
  const declared = numbers.map((n, i) => {
    vars[`n${i}`] = n;
    return `$n${i}:Int!`;
  });
  const prs = numbers.map((_, i) => `pr${i}:pullRequest(number:$n${i}){${fields(`$n${i}`)}}`).join(' ');
  return { query: `query($owner:String!,$name:String!,${declared.join(',')}){${RATE_LIMIT} repository(owner:$owner,name:$name){${prs}}}`, vars };
}

const chunksOf = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

export interface LightPr {
  number: number;
  url: string;
  title: string;
  state: string;
  isDraft: boolean;
  isCrossRepository: boolean;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  mergeable: string;
  updatedAt: string;
  rollupState: string | null;
  reviewDecision: string | null;
  fingerprint: string;
}

const LIGHT_QUERY = `query($q:String!,$after:String){${RATE_LIMIT} search(query:$q,type:ISSUE,first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{... on PullRequest{number url title state isDraft isCrossRepository headRefName headRefOid baseRefName mergeable updatedAt reviewDecision commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}}`;
/** GitHub's search returns at most 1,000 results. */
const MAX_SEARCH_PAGES = 10;

type LightNode = Omit<LightPr, 'rollupState' | 'fingerprint'> & { commits?: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] } };

export function lightFingerprint(pr: Omit<LightPr, 'fingerprint'>): string {
  const parts = [pr.headRefOid, pr.baseRefName, pr.mergeable, pr.rollupState, pr.reviewDecision, pr.isDraft, pr.updatedAt];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

function toLight(n: LightNode): LightPr {
  const { commits, ...rest } = n;
  const pr = { ...rest, rollupState: commits?.nodes[0]?.commit.statusCheckRollup?.state ?? null, reviewDecision: n.reviewDecision ?? null };
  return { ...pr, fingerprint: lightFingerprint(pr) };
}

/** Phase 1: every open PR in one repo, one paginated GraphQL search, no checks detail. Search can lag a new PR by a few seconds. */
export async function openPrsLight(run: GhRunner, repo: Repo): Promise<LightPr[] | null> {
  type Page = { search: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Partial<LightNode>[] } };
  const q = `repo:${repo.owner}/${repo.name} is:pr is:open`;
  const prs: LightPr[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
    const data: Page | null = await graphql<Page>(run, LIGHT_QUERY, { q, after });
    if (!data?.search) return null;
    prs.push(...data.search.nodes.filter((n): n is LightNode => typeof n.number === 'number').map(toLight));
    if (!data.search.pageInfo.hasNextPage) break;
    after = data.search.pageInfo.endCursor;
  }
  return prs;
}

export interface DetailedCheck {
  name: string;
  workflowName: string | null;
  conclusion: string | null;
  status: string | null;
  isRequired: boolean;
  url: string | null;
  startedAt: string | null;
  /** A status context's description ("needs review from @team"), or a check run's title. */
  description: string | null;
}

export interface PrDetail {
  snapshot: PrSnapshot;
  threads: ReviewThread[];
  checks: DetailedCheck[];
}

interface PageInfo {
  hasNextPage?: boolean;
  endCursor?: string | null;
  hasPreviousPage?: boolean;
  startCursor?: string | null;
}

interface Connection<N> {
  pageInfo: PageInfo;
  nodes: N[];
}

type ContextNode =
  | {
      __typename: 'CheckRun';
      name: string;
      conclusion: string | null;
      status: string | null;
      startedAt: string | null;
      detailsUrl: string | null;
      title: string | null;
      isRequired: boolean;
      checkSuite: { workflowRun: { workflow: { name: string } | null } | null } | null;
    }
  | { __typename: 'StatusContext'; context: string; state: string; targetUrl: string | null; description: string | null; createdAt: string; isRequired: boolean };

type CommentNode = { author: AuthorNode | null; body: string; createdAt: string; url: string; isMinimized: boolean };
type ReviewNode = { author: AuthorNode | null; state: string; body: string; submittedAt: string };

interface DetailNode {
  number: number;
  url: string;
  state: string;
  isDraft: boolean;
  mergeable: string;
  baseRefName: string;
  headRefOid: string;
  commits: { nodes: { commit: { statusCheckRollup: { contexts: Connection<ContextNode> } | null } }[] };
  reviewThreads: Connection<ThreadNode>;
  comments: Connection<CommentNode>;
  reviews: Connection<ReviewNode>;
}

/** How one paginated connection of a PR is asked for, read back, and walked: forwards (oldest first) or backwards (newest first). */
interface Paged<N> {
  select(numberVar: string, cursor: string): string;
  of(pr: DetailNode): Connection<N> | undefined;
  backwards: boolean;
}

const page = (size: number, backwards: boolean, cursor: string) =>
  `${backwards ? 'last' : 'first'}:${size}${cursor ? `,${backwards ? 'before' : 'after'}:${cursor}` : ''}`;
const FORWARD_PAGE = 'pageInfo{hasNextPage endCursor}';
const BACKWARD_PAGE = 'pageInfo{hasPreviousPage startCursor}';

const contextsPaged: Paged<ContextNode> = {
  select: (n, cursor) =>
    `commits(last:1){nodes{commit{statusCheckRollup{contexts(${page(100, false, cursor)}){${FORWARD_PAGE} nodes{__typename ` +
    `... on CheckRun{name conclusion status startedAt detailsUrl title isRequired(pullRequestNumber:${n}) checkSuite{workflowRun{workflow{name}}}} ` +
    `... on StatusContext{context state targetUrl description createdAt isRequired(pullRequestNumber:${n})}}}}}}}`,
  of: (pr) => pr.commits?.nodes[0]?.commit.statusCheckRollup?.contexts,
  backwards: false,
};

const threadsPaged: Paged<ThreadNode> = {
  select: (_, cursor) =>
    `reviewThreads(${page(100, false, cursor)}){${FORWARD_PAGE} nodes{id isResolved isOutdated path line comments(first:50){nodes{databaseId author{login __typename} body createdAt}}}}`,
  of: (pr) => pr.reviewThreads,
  backwards: false,
};

const commentsPaged: Paged<CommentNode> = {
  select: (_, cursor) => `comments(${page(50, true, cursor)}){${BACKWARD_PAGE} nodes{author{login __typename} body createdAt url isMinimized}}`,
  of: (pr) => pr.comments,
  backwards: true,
};

const reviewsPaged: Paged<ReviewNode> = {
  select: (_, cursor) => `reviews(${page(50, true, cursor)}){${BACKWARD_PAGE} nodes{author{login __typename} state body submittedAt}}`,
  of: (pr) => pr.reviews,
  backwards: true,
};

const DETAIL_SCALARS = 'number url state isDraft mergeable baseRefName headRefOid';
const detailFields = (n: string) =>
  [DETAIL_SCALARS, ...[contextsPaged, threadsPaged, commentsPaged, reviewsPaged].map((p) => p.select(n, ''))].join(' ');

/** PRs per detail query: about one rate-limit point each, and a few keep a query far from GitHub's node and time limits. */
export const DETAIL_CHUNK = 4;
const MAX_PAGES = 20;

/** Every node of a connection, asking GitHub for the pages the first answer did not hold. Null when a page could not be read. */
async function allNodes<N>(run: GhRunner, repo: Repo, number: number, paged: Paged<N>, first: Connection<N> | undefined): Promise<N[] | null> {
  if (!first) return [];
  let nodes = first.nodes;
  let info = first.pageInfo;
  for (let i = 0; i < MAX_PAGES; i++) {
    const cursor = paged.backwards ? (info.hasPreviousPage ? info.startCursor : null) : info.hasNextPage ? info.endCursor : null;
    if (!cursor) return nodes;
    const query = `query($owner:String!,$name:String!,$number:Int!,$cursor:String!){${RATE_LIMIT} repository(owner:$owner,name:$name){pullRequest(number:$number){${paged.select('$number', '$cursor')}}}}`;
    const data = await graphql<{ repository: { pullRequest: DetailNode | null } }>(run, query, { owner: repo.owner, name: repo.name, number, cursor });
    const more = data?.repository?.pullRequest ? paged.of(data.repository.pullRequest) : undefined;
    if (!more) return null;
    nodes = paged.backwards ? [...more.nodes, ...nodes] : [...nodes, ...more.nodes];
    info = more.pageInfo;
  }
  return nodes;
}

function toCheckRun(c: ContextNode): CheckRun {
  if (c.__typename === 'StatusContext') {
    return { __typename: c.__typename, context: c.context, state: c.state, targetUrl: c.targetUrl ?? undefined, startedAt: c.createdAt };
  }
  return {
    __typename: c.__typename,
    name: c.name,
    workflowName: c.checkSuite?.workflowRun?.workflow?.name ?? '',
    conclusion: c.conclusion ?? undefined,
    status: c.status ?? undefined,
    startedAt: c.startedAt ?? undefined,
    detailsUrl: c.detailsUrl ?? undefined,
  };
}

function toDetailedCheck(c: ContextNode): DetailedCheck {
  if (c.__typename === 'StatusContext') {
    return { name: c.context, workflowName: null, conclusion: c.state, status: null, isRequired: c.isRequired, url: c.targetUrl, startedAt: c.createdAt, description: c.description };
  }
  return {
    name: c.name,
    workflowName: c.checkSuite?.workflowRun?.workflow?.name || null,
    conclusion: c.conclusion,
    status: c.status,
    isRequired: c.isRequired,
    url: c.detailsUrl,
    startedAt: c.startedAt,
    description: c.title,
  };
}

async function detailOf(run: GhRunner, repo: Repo, pr: DetailNode): Promise<PrDetail | null> {
  const [contexts, threads, comments, reviews] = await Promise.all([
    allNodes(run, repo, pr.number, contextsPaged, contextsPaged.of(pr)),
    allNodes(run, repo, pr.number, threadsPaged, threadsPaged.of(pr)),
    allNodes(run, repo, pr.number, commentsPaged, commentsPaged.of(pr)),
    allNodes(run, repo, pr.number, reviewsPaged, reviewsPaged.of(pr)),
  ]);
  if (!contexts || !threads || !comments || !reviews) return null;
  const snapshot = prSnapshotFrom({
    ...pr,
    statusCheckRollup: contexts.map(toCheckRun),
    comments: comments.filter((c) => !c.isMinimized),
    reviews,
  });
  return { snapshot, threads: threadsFrom(threads), checks: contexts.map(toDetailedCheck) };
}

/**
 * Phase 2: the full state of the given PRs, DETAIL_CHUNK PRs per aliased query, with the pages of checks, threads,
 * comments and reviews one query did not hold. `snapshot` and `threads` mean what prSnapshot() and unresolvedThreads()
 * return, except that minimized comments are left out. A PR GitHub does not know is missing from the map.
 */
export async function prDetails(run: GhRunner, repo: Repo, numbers: number[]): Promise<Map<number, PrDetail> | null> {
  const details = new Map<number, PrDetail>();
  for (const chunk of chunksOf([...new Set(numbers)], DETAIL_CHUNK)) {
    const { query, vars } = aliased(chunk, detailFields);
    const data = await graphql<{ repository: Record<string, DetailNode | null> | null }>(run, query, { owner: repo.owner, name: repo.name, ...vars });
    if (!data?.repository) return null;
    for (const pr of Object.values(data.repository)) {
      if (!pr) continue;
      const detail = await detailOf(run, repo, pr);
      if (!detail) return null;
      details.set(pr.number, detail);
    }
  }
  return details;
}

/** The checks only people turn green that still wait, as `humanChecks()` reads them from `gh pr checks`. */
export function humanChecksOf(checks: DetailedCheck[]): HumanCheck[] {
  const bucketOf = (c: DetailedCheck) => {
    const outcome = (c.status === 'COMPLETED' || !c.status ? c.conclusion : c.status) ?? '';
    if (outcome === 'SUCCESS') return 'pass';
    if (outcome === 'SKIPPED' || outcome === 'NEUTRAL') return 'skipping';
    if (outcome === 'CANCELLED') return 'cancel';
    return ['ERROR', 'FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(outcome) ? 'fail' : 'pending';
  };
  return humanChecksFrom(
    checks.map((c) => ({ name: c.name, bucket: bucketOf(c), description: c.description ?? '', link: c.url ?? '', startedAt: c.startedAt ?? undefined })),
  );
}

export interface PrState {
  state: string;
  isDraft: boolean;
  headRefOid: string;
  baseRefName: string;
  mergeCommit: string | null;
}

const STATES_CHUNK = 50;

/** The state of each PR by number, open, merged or closed; one query per 50 numbers, about one point each. */
export async function prStates(run: GhRunner, repo: Repo, numbers: number[]): Promise<Map<number, PrState> | null> {
  type Node = Omit<PrState, 'mergeCommit'> & { number: number; mergeCommit: { oid: string } | null };
  const states = new Map<number, PrState>();
  for (const chunk of chunksOf([...new Set(numbers)], STATES_CHUNK)) {
    const { query, vars } = aliased(chunk, () => 'number state isDraft headRefOid baseRefName mergeCommit{oid}');
    const data = await graphql<{ repository: Record<string, Node | null> | null }>(run, query, { owner: repo.owner, name: repo.name, ...vars });
    if (!data?.repository) return null;
    for (const pr of Object.values(data.repository)) {
      if (pr) states.set(pr.number, { state: pr.state, isDraft: pr.isDraft, headRefOid: pr.headRefOid, baseRefName: pr.baseRefName, mergeCommit: pr.mergeCommit?.oid ?? null });
    }
  }
  return states;
}

const MAX_LOG_LINES = 150;
const MAX_LOG_BYTES = 12_000;
const LINES_BEFORE_ERROR = 40;
const MAX_LINE_CHARS = 400;
const TIMESTAMP = /^\uFEFF?\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/;
const RUN_LOG_PREFIX = /^[^\t]*\t[^\t]*\t/;
const ERROR_LINE = /^##\[error\]/;
const FAILURE_LINE = /^(FAILED |ERROR |●)/;
const SUMMARY_START = /^=+ short test summary info =+$/;
const SUMMARY_END = /^=+ .+ =+$/;
/** pre-commit and prek: `Generate OpenAPI specs.....Failed`, then `- hook id: …`, `- exit code: …` lines. */
const FAILED_HOOK = /\.{3,}\s*Failed$/;
const HOOK_DETAIL = /^- /;

/** The lines of a CI log that say what failed, at most MAX_LOG_LINES lines and MAX_LOG_BYTES; the log's tail when nothing marks a failure. */
export function failureExcerpt(log: string): string {
  const lines = log.split(/\r?\n/).map((l) => l.replace(TIMESTAMP, '').replace(/\s+$/, ''));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const indexes = (match: (line: string) => boolean) => lines.flatMap((line, i) => (match(line) ? [i] : []));
  const blockFrom = (first: number, isEnd: (line: string) => boolean, endBelongs: boolean) => {
    let last = first;
    while (last + 1 < lines.length && !isEnd(lines[last + 1])) last++;
    if (endBelongs && last + 1 < lines.length) last++;
    return Array.from({ length: last - first + 1 }, (_, k) => first + k);
  };
  const errors = indexes((l) => ERROR_LINE.test(l));
  const summaries = indexes((l) => SUMMARY_START.test(l)).flatMap((i) => blockFrom(i, (l) => SUMMARY_END.test(l), true));
  const hooks = indexes((l) => FAILED_HOOK.test(l)).flatMap((i) => blockFrom(i, (l) => !HOOK_DETAIL.test(l), false));
  const failures = indexes((l) => FAILURE_LINE.test(l.trimStart()));
  const picked = new Set<number>();
  for (const i of [...errors, ...hooks, ...summaries, ...failures]) if (picked.size < MAX_LOG_LINES) picked.add(i);
  const firstError = errors[0] ?? -1;
  for (let i = firstError - 1; i >= Math.max(0, firstError - LINES_BEFORE_ERROR) && picked.size < MAX_LOG_LINES; i--) picked.add(i);
  const keep = picked.size ? [...picked].sort((a, b) => a - b) : lines.map((_, i) => i).slice(-MAX_LOG_LINES);
  const out: string[] = [];
  keep.forEach((i, k) => {
    if (k > 0 && i !== keep[k - 1] + 1) out.push('…');
    out.push(lines[i].length > MAX_LINE_CHARS ? `${lines[i].slice(0, MAX_LINE_CHARS)}…` : lines[i]);
  });
  while (out.length > 1 && (out.length > MAX_LOG_LINES || Buffer.byteLength(out.join('\n')) > MAX_LOG_BYTES)) out.shift();
  if (out[0] === '…') out.shift();
  return out.join('\n');
}

export interface JobLog {
  /** Every line, without GitHub's timestamps and job prefixes: what a check policy's log pattern is matched against. */
  full: string;
  excerpt: string;
}

/**
 * The useful part of a failed CI job's log, from the check's details URL (`.../actions/runs/<run>/job/<job>`): that
 * job's log only, or the run's failed jobs when the URL names no job. Null when nothing could be read.
 */
export async function failedJobLog(run: GhRunner, url: string | null): Promise<string | null> {
  return (await failedJobLogs(run, url))?.excerpt ?? null;
}

export async function failedJobLogs(run: GhRunner, url: string | null): Promise<JobLog | null> {
  const ids = url?.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/actions\/runs\/(\d+)(?:\/job\/(\d+))?/);
  if (!ids || !githubBudget.canSpend()) return null;
  const [, owner, name, runId, jobId] = ids;
  const r = jobId
    ? await run(['api', `repos/${owner}/${name}/actions/jobs/${jobId}/logs`])
    : await run(['run', 'view', runId, '--log-failed', '-R', `${owner}/${name}`]);
  if (r.code !== 0 || !r.stdout.trim()) {
    githubBudget.noteRefusal(r.stderr);
    return null;
  }
  const log = jobId ? r.stdout : r.stdout.split('\n').map((l) => l.replace(RUN_LOG_PREFIX, '')).join('\n');
  const full = log.split(/\r?\n/).map((l) => l.replace(TIMESTAMP, '')).join('\n');
  return { full, excerpt: failureExcerpt(log) };
}
