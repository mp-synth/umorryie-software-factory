import { exec } from './git.ts';

export const FACTORY_MARKER = '<!-- software-factory -->';
export const COMMENT_PREFIX = '**Claude Bot Automation**';

export function factoryCommentBody(body: string): string {
  return `${FACTORY_MARKER}\n${COMMENT_PREFIX}\n\n${body}`;
}

const CHECKS_ONLY_HUMANS_TURN_GREEN = /^(Code review( gate)?|Meticulous (Tests|Checks))$/;

export function isBot(login: string): boolean {
  return login.endsWith('[bot]');
}

async function gh(cwd: string, args: string[], input?: string, timeoutMs = 60_000) {
  return exec('gh', args, { cwd, input, timeoutMs, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } });
}

export async function ghUser(): Promise<string | null> {
  const r = await exec('gh', ['api', 'user', '--jq', '.login'], { timeoutMs: 15_000 });
  return r.code === 0 ? r.stdout.trim() : null;
}

export interface PrRef {
  number: number;
  url: string;
  state: string;
}

export async function findPr(cwd: string, branch: string): Promise<PrRef | null> {
  const r = await gh(cwd, ['pr', 'list', '--head', branch, '--state', 'all', '--json', 'number,url,state', '--limit', '1']);
  if (r.code !== 0) return null;
  const list = JSON.parse(r.stdout || '[]') as PrRef[];
  return list[0] ?? null;
}

export interface OpenPr {
  number: number;
  title: string;
  url: string;
  body: string;
  headRefName: string;
  baseRefName: string;
  isCrossRepository: boolean;
}

export async function myOpenPrs(cwd: string): Promise<OpenPr[]> {
  const r = await gh(cwd, [
    'pr', 'list', '--author', '@me', '--state', 'open', '--limit', '100', '--json', 'number,title,url,body,headRefName,baseRefName,isCrossRepository',
  ]);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `gh pr list exited ${r.code}`);
  return JSON.parse(r.stdout || '[]') as OpenPr[];
}

export async function createPr(
  cwd: string,
  opts: { base: string; head: string; title: string; body: string },
): Promise<{ pr: PrRef | null; error: string | null }> {
  const r = await gh(cwd, [
    'pr', 'create', '--draft', '--base', opts.base, '--head', opts.head, '--title', opts.title, '--body-file', '-',
  ], opts.body);
  if (r.code !== 0) return { pr: null, error: (r.stderr || r.stdout).trim() };
  const url = r.stdout.trim().split('\n').pop() ?? '';
  const m = url.match(/\/pull\/(\d+)/);
  return { pr: m ? { number: Number(m[1]), url, state: 'OPEN' } : null, error: m ? null : `unexpected gh output: ${url}` };
}

export interface PrStack {
  number: number;
  pullRequests: number[];
  /** PRs still in the stack that were closed without merging: GitHub keeps them, and nothing can stack above them. */
  closed?: number[];
  merged?: number[];
}

const API_VERSION = ['-H', 'X-GitHub-Api-Version: 2026-03-10'];

type StackPr = { number: number; state?: string; merged_at?: string | null };

function toStack(d: { number: number; pull_requests: StackPr[] }): PrStack {
  return {
    number: d.number,
    pullRequests: d.pull_requests.map((p) => p.number),
    closed: d.pull_requests.filter((p) => p.state === 'closed' && !p.merged_at).map((p) => p.number),
    merged: d.pull_requests.filter((p) => !!p.merged_at).map((p) => p.number),
  };
}

async function stacksApi(cwd: string, args: string[], body?: unknown): Promise<string> {
  const r = await gh(cwd, ['api', ...API_VERSION, ...args, ...(body ? ['--input', '-'] : [])], body ? JSON.stringify(body) : undefined);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `gh api exited ${r.code}`);
  return r.stdout;
}

export async function stackOf(cwd: string, prNumber: number): Promise<PrStack | null> {
  const list = JSON.parse((await stacksApi(cwd, [`repos/{owner}/{repo}/stacks?pull_request=${prNumber}`])) || '[]');
  return list[0] ? toStack(list[0]) : null;
}

export async function createStack(cwd: string, prs: number[]): Promise<PrStack> {
  return toStack(JSON.parse(await stacksApi(cwd, ['-X', 'POST', 'repos/{owner}/{repo}/stacks'], { pull_requests: prs })));
}

export async function addToStack(cwd: string, stack: number, prs: number[]): Promise<PrStack> {
  return toStack(JSON.parse(await stacksApi(cwd, ['-X', 'POST', `repos/{owner}/{repo}/stacks/${stack}/add`], { pull_requests: prs })));
}

/**
 * Takes every unmerged PR out of a stack. The API can't remove single PRs; a stack left empty is dissolved.
 * Returns the PRs GitHub kept (merged or queued for merge), so an empty list means the stack is gone.
 */
export async function unstack(cwd: string, stack: number): Promise<number[]> {
  const out = (await stacksApi(cwd, ['-X', 'POST', `repos/{owner}/{repo}/stacks/${stack}/unstack`])).trim();
  return out ? toStack(JSON.parse(out)).pullRequests : [];
}

export async function editPr(cwd: string, prNumber: number, edit: { title: string; body: string }): Promise<void> {
  const r = await gh(cwd, ['pr', 'edit', String(prNumber), '--title', edit.title, '--body-file', '-'], edit.body);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `gh pr edit exited ${r.code}`);
}

export interface MergeStatus {
  state: string;
  isDraft: boolean;
  isInMergeQueue: boolean;
  mergeStateStatus: string;
  baseRefName: string;
  headRefOid: string;
}

export async function mergeStatus(cwd: string, prNumber: number): Promise<MergeStatus | null> {
  const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){state isDraft isInMergeQueue mergeStateStatus baseRefName headRefOid}}}`;
  const r = await gh(cwd, ['api', 'graphql', '-f', `query=${query}`, '-F', 'owner={owner}', '-F', 'name={repo}', '-F', `number=${prNumber}`, '-q', '.data.repository.pullRequest']);
  return r.code === 0 && r.stdout.trim() ? (JSON.parse(r.stdout) as MergeStatus) : null;
}

export async function markReady(cwd: string, prNumber: number): Promise<void> {
  const r = await gh(cwd, ['pr', 'ready', String(prNumber)]);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `gh pr ready exited ${r.code}`);
}

export type MergeQueueOutcome = 'queued' | 'in-queue' | 'merged' | 'pending' | 'failed';

interface AsyncMerge {
  status: 'pending' | 'merged' | 'enqueued' | 'failed';
  details?: { message?: string; uuid?: string };
  message?: string;
}

const MERGE_POLLS = 10;
const MERGE_POLL_MS = 3000;

function parseAsyncMerge(stdout: string): AsyncMerge | null {
  try {
    return JSON.parse(stdout) as AsyncMerge;
  } catch {
    return null;
  }
}

export async function addToMergeQueue(cwd: string, prNumber: number, headSha: string): Promise<{ outcome: MergeQueueOutcome; message: string | null }> {
  const endpoint = `repos/{owner}/{repo}/pulls/${prNumber}/merge-async`;
  const r = await gh(cwd, ['api', ...API_VERSION, '-X', 'PUT', endpoint, '--input', '-'], JSON.stringify({ sha: headSha, merge_action: 'merge_queue' }));
  let result = parseAsyncMerge(r.stdout);
  if (r.code !== 0) {
    if (/HTTP 409/.test(r.stderr)) return { outcome: 'pending', message: null };
    return { outcome: 'failed', message: result?.message ?? result?.details?.message ?? (r.stderr.trim() || `gh api exited ${r.code}`) };
  }
  if (result?.status === 'enqueued') return { outcome: 'in-queue', message: null };
  if (result?.status === 'merged') return { outcome: 'merged', message: null };
  const uuid = result?.details?.uuid;
  for (let poll = 0; uuid && result?.status === 'pending' && poll < MERGE_POLLS; poll++) {
    await new Promise((resolve) => setTimeout(resolve, MERGE_POLL_MS));
    const p = await gh(cwd, ['api', ...API_VERSION, `${endpoint}/${uuid}`]);
    if (p.code === 0) result = parseAsyncMerge(p.stdout);
  }
  switch (result?.status) {
    case 'enqueued':
      return { outcome: 'queued', message: null };
    case 'merged':
      return { outcome: 'merged', message: null };
    case 'failed':
      return { outcome: 'failed', message: result.details?.message ?? null };
    default:
      return { outcome: 'pending', message: null };
  }
}

export async function retargetPr(cwd: string, prNumber: number, base: string): Promise<void> {
  const current = await gh(cwd, ['pr', 'view', String(prNumber), '--json', 'baseRefName', '-q', '.baseRefName']);
  if (current.code === 0 && current.stdout.trim() === base) return;
  const r = await gh(cwd, ['pr', 'edit', String(prNumber), '--base', base]);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `gh pr edit exited ${r.code}`);
}

export async function closePr(cwd: string, prNumber: number, why: string): Promise<void> {
  await comment(cwd, prNumber, why);
  const r = await gh(cwd, ['pr', 'close', String(prNumber)]);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `gh pr close exited ${r.code}`);
}

export async function comment(cwd: string, prNumber: number, body: string): Promise<void> {
  await gh(cwd, ['pr', 'comment', String(prNumber), '--body-file', '-'], factoryCommentBody(body));
}

export interface CheckRun {
  __typename?: string;
  name?: string;
  context?: string;
  workflowName?: string;
  conclusion?: string;
  state?: string;
  status?: string;
  startedAt?: string;
  detailsUrl?: string;
  targetUrl?: string;
}

const FAILING_OUTCOMES = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);

const outcomeOf = (c: CheckRun) => (c.conclusion ?? c.state ?? '').toUpperCase();
const isFailing = (c: CheckRun) => FAILING_OUTCOMES.has(outcomeOf(c));
const checkName = (c: CheckRun) => c.name ?? c.context ?? 'check';
const checkUrl = (c: CheckRun) => c.detailsUrl ?? c.targetUrl ?? null;
const runIdOf = (c: CheckRun) => {
  const id = actionsRunId(checkUrl(c));
  return id ? Number(id) : null;
};
const runKey = (c: CheckRun) => String(runIdOf(c) ?? c.startedAt ?? '');

function isNewerRun(other: CheckRun, c: CheckRun): boolean {
  const [a, b] = [runIdOf(other), runIdOf(c)];
  if (a !== null && b !== null) return a > b;
  return Date.parse(other.startedAt ?? '') > Date.parse(c.startedAt ?? '');
}

function isSuperseded(c: CheckRun, all: CheckRun[]): boolean {
  if (outcomeOf(c) !== 'CANCELLED') return false;
  if (all.some((o) => o !== c && checkName(o) === checkName(c) && o.workflowName === c.workflowName && !isFailing(o))) return true;
  if (!c.workflowName) return false;
  const newer = all.filter((o) => o.workflowName === c.workflowName && isNewerRun(o, c));
  return [...new Set(newer.map(runKey))].some((key) => newer.filter((o) => runKey(o) === key).every((o) => !isFailing(o)));
}

export interface PrCheck {
  name: string;
  url: string | null;
}

export function splitFailingChecks(checks: CheckRun[]): { failing: PrCheck[]; superseded: PrCheck[] } {
  const toCheck = (c: CheckRun) => ({ name: checkName(c), url: checkUrl(c) });
  const bad = checks.filter(isFailing);
  return {
    failing: bad.filter((c) => !isSuperseded(c, checks)).map(toCheck),
    superseded: bad.filter((c) => isSuperseded(c, checks)).map(toCheck),
  };
}

export interface PrSnapshot {
  number: number;
  url: string;
  state: string;
  isDraft: boolean;
  mergeable: string;
  baseRefName: string;
  headRefOid: string;
  failingChecks: PrCheck[];
  supersededChecks: PrCheck[];
  pendingChecks: string[];
  finishedChecks: number;
  comments: { author: string; body: string; createdAt: string; url: string }[];
  reviews: { author: string; state: string; body: string; submittedAt: string }[];
}

export type CiState = 'green' | 'red' | 'pending' | 'none';

export function ciStateOf(snap: Pick<PrSnapshot, 'failingChecks' | 'pendingChecks' | 'finishedChecks'>): CiState {
  if (snap.failingChecks.length) return 'red';
  if (snap.pendingChecks.length) return 'pending';
  return snap.finishedChecks ? 'green' : 'none';
}

export type PrCi = Pick<PrSnapshot, 'state' | 'headRefOid' | 'failingChecks' | 'supersededChecks' | 'pendingChecks' | 'finishedChecks'>;

function ciOf(d: { state: string; headRefOid: string; statusCheckRollup?: CheckRun[] | null }): PrCi {
  const checks = (d.statusCheckRollup ?? []).filter((c) => !CHECKS_ONLY_HUMANS_TURN_GREEN.test(c.name ?? c.context ?? ''));
  const { failing, superseded } = splitFailingChecks(checks);
  const pendingChecks = checks
    .filter((c) => ['IN_PROGRESS', 'QUEUED', 'PENDING', 'WAITING'].includes((c.status ?? c.state ?? '').toUpperCase()))
    .map((c) => c.name ?? c.context ?? 'check');
  return {
    state: d.state,
    headRefOid: d.headRefOid,
    failingChecks: failing,
    supersededChecks: superseded,
    pendingChecks,
    finishedChecks: checks.length - pendingChecks.length,
  };
}

/** A check only people turn green (a code-owner review, a visual-diff approval) that is not green yet. */
export interface HumanCheck {
  name: string;
  state: 'pending' | 'failing';
  /** What the check says it waits for, such as "needs review from @growth"; may be empty. */
  description: string;
  url: string | null;
}

export interface CheckListEntry {
  name: string;
  bucket: string;
  description?: string;
  link?: string;
  startedAt?: string;
}

export function humanChecksFrom(entries: CheckListEntry[]): HumanCheck[] {
  const started = (e: CheckListEntry) => Date.parse(e.startedAt ?? '') || 0;
  const latest = new Map<string, CheckListEntry>();
  for (const e of entries) {
    if (!CHECKS_ONLY_HUMANS_TURN_GREEN.test(e.name)) continue;
    const seen = latest.get(e.name);
    if (!seen || started(e) > started(seen)) latest.set(e.name, e);
  }
  return [...latest.values()]
    .filter((e) => e.bucket === 'pending' || e.bucket === 'fail')
    .map((e) => ({ name: e.name, state: e.bucket === 'pending' ? 'pending' : 'failing', description: e.description?.trim() ?? '', url: e.link || null }));
}

/** Null when gh can't list the checks. The rollup `pr view` returns has no descriptions, so this asks `pr checks`. */
export async function humanChecks(cwd: string, prNumber: number): Promise<HumanCheck[] | null> {
  const r = await gh(cwd, ['pr', 'checks', String(prNumber), '--json', 'name,bucket,description,link,startedAt']);
  try {
    return humanChecksFrom(JSON.parse(r.stdout));
  } catch {
    return null;
  }
}

/** Only a PR's head and checks, for polling CI without fetching its comments and reviews. */
export async function prCi(cwd: string, prNumber: number): Promise<PrCi | null> {
  const r = await gh(cwd, ['pr', 'view', String(prNumber), '--json', 'state,headRefOid,statusCheckRollup']);
  return r.code === 0 ? ciOf(JSON.parse(r.stdout)) : null;
}

export async function prSnapshot(cwd: string, prNumber: number): Promise<PrSnapshot | null> {
  const r = await gh(cwd, [
    'pr', 'view', String(prNumber), '--json',
    'number,url,state,isDraft,mergeable,baseRefName,headRefOid,statusCheckRollup,comments,reviews',
  ]);
  if (r.code !== 0) return null;
  const d = JSON.parse(r.stdout);
  const notMarker = (body: string) => !body.includes(FACTORY_MARKER);
  return {
    ...ciOf(d),
    number: d.number,
    url: d.url,
    isDraft: d.isDraft,
    mergeable: d.mergeable,
    baseRefName: d.baseRefName,
    comments: (d.comments ?? [])
      .filter((c: { body: string }) => notMarker(c.body))
      .map((c: { author?: { login: string }; body: string; createdAt: string; url: string }) => ({
        author: c.author?.login ?? 'unknown',
        body: c.body,
        createdAt: c.createdAt,
        url: c.url,
      })),
    reviews: (d.reviews ?? [])
      .filter((c: { body: string; state: string }) => notMarker(c.body) && (c.body.trim() || c.state === 'CHANGES_REQUESTED'))
      .map((c: { author?: { login: string }; state: string; body: string; submittedAt: string }) => ({
        author: c.author?.login ?? 'unknown',
        state: c.state,
        body: c.body,
        submittedAt: c.submittedAt,
      })),
  };
}

export interface ReviewThread {
  id: string;
  rootCommentId: number;
  rootAuthor: string;
  rootIsBot: boolean;
  path: string;
  line: number | null;
  outdated: boolean;
  /** The factory wrote the newest comment, so the thread waits for its reviewer. */
  awaitingReviewer: boolean;
  lastCommentAt: string;
  comments: { author: string; body: string }[];
}

interface ThreadNode {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  comments: { nodes: { databaseId: number; author?: { login: string; __typename?: string }; body: string; createdAt: string }[] };
}

export async function unresolvedThreads(cwd: string, prNumber: number): Promise<ReviewThread[] | null> {
  const repo = await gh(cwd, ['repo', 'view', '--json', 'owner,name']);
  if (repo.code !== 0) return null;
  const { owner, name } = JSON.parse(repo.stdout) as { owner: { login: string }; name: string };
  const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{id isResolved isOutdated path line comments(first:50){nodes{databaseId author{login __typename} body createdAt}}}}}}}`;
  const r = await gh(cwd, [
    'api', 'graphql', '-f', `query=${query}`, '-F', `owner=${owner.login}`, '-F', `name=${name}`, '-F', `number=${prNumber}`,
  ]);
  if (r.code !== 0) return null;
  const nodes: ThreadNode[] = JSON.parse(r.stdout)?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
  return nodes
    .filter((t) => !t.isResolved && t.comments.nodes.length > 0)
    .map((t) => {
      const all = t.comments.nodes;
      const last = all[all.length - 1];
      return {
        id: t.id,
        rootCommentId: all[0].databaseId,
        rootAuthor: all[0].author?.login ?? 'unknown',
        rootIsBot: all[0].author?.__typename === 'Bot' || isBot(all[0].author?.login ?? ''),
        path: t.path,
        line: t.line,
        outdated: t.isOutdated,
        awaitingReviewer: last.body.includes(FACTORY_MARKER),
        lastCommentAt: last.createdAt,
        comments: all
          .filter((c) => !c.body.includes(FACTORY_MARKER))
          .map((c) => ({ author: c.author?.login ?? 'unknown', body: c.body })),
      };
    })
    .filter((t) => t.comments.length > 0);
}

export async function replyToThread(cwd: string, prNumber: number, rootCommentId: number, body: string): Promise<void> {
  const r = await gh(cwd, [
    'api', '-X', 'POST', `repos/{owner}/{repo}/pulls/${prNumber}/comments/${rootCommentId}/replies`, '-f', `body=${factoryCommentBody(body)}`,
  ]);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
}

export async function resolveThread(cwd: string, threadId: string): Promise<void> {
  const r = await gh(cwd, [
    'api', 'graphql', '-f', 'query=mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}', '-f', `id=${threadId}`,
  ]);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
}

export function actionsRunId(url: string | null): string | null {
  return url?.match(/\/actions\/runs\/(\d+)/)?.[1] ?? null;
}

export async function checkConclusionOn(cwd: string, ref: string, checkName: string): Promise<string | null> {
  const r = await gh(cwd, [
    'api', '-X', 'GET', `repos/{owner}/{repo}/commits/${ref}/check-runs`, '-f', `check_name=${checkName}`, '-q', '.check_runs[0].conclusion // ""',
  ]);
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

export async function rerunFailedOnce(cwd: string, runId: string): Promise<'rerun' | 'already-rerun' | 'failed'> {
  const attempt = await gh(cwd, ['api', `repos/{owner}/{repo}/actions/runs/${runId}`, '-q', '.run_attempt']);
  if (attempt.code !== 0) return 'failed';
  if (Number(attempt.stdout.trim()) > 1) return 'already-rerun';
  const r = await gh(cwd, ['run', 'rerun', runId, '--failed']);
  return r.code === 0 ? 'rerun' : 'failed';
}

export async function failedLog(cwd: string, url: string | null): Promise<string | null> {
  const runId = actionsRunId(url);
  if (!runId) return null;
  const r = await gh(cwd, ['run', 'view', runId, '--log-failed'], undefined, 90_000);
  if (r.code !== 0) return null;
  return r.stdout.split('\n').slice(-120).join('\n');
}
