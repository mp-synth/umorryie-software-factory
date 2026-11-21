import { exec } from './git.ts';

/** Marker on every comment the factory posts, so it never feeds its own output back to agents. */
export const FACTORY_MARKER = '<!-- software-factory -->';

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

export async function markReady(cwd: string, prNumber: number): Promise<void> {
  await gh(cwd, ['pr', 'ready', String(prNumber)]);
}

export async function comment(cwd: string, prNumber: number, body: string): Promise<void> {
  await gh(cwd, ['pr', 'comment', String(prNumber), '--body-file', '-'], `${FACTORY_MARKER}\n${body}`);
}

interface CheckRun {
  __typename?: string;
  name?: string;
  context?: string;
  conclusion?: string;
  state?: string;
  status?: string;
  detailsUrl?: string;
  targetUrl?: string;
}

export interface PrSnapshot {
  number: number;
  url: string;
  state: string; // OPEN | CLOSED | MERGED
  isDraft: boolean;
  mergeable: string; // MERGEABLE | CONFLICTING | UNKNOWN
  baseRefName: string;
  headRefOid: string;
  failingChecks: { name: string; url: string | null }[];
  pendingChecks: string[];
  comments: { author: string; body: string; createdAt: string }[];
  reviews: { author: string; state: string; body: string }[];
}

export async function prSnapshot(cwd: string, prNumber: number): Promise<PrSnapshot | null> {
  const r = await gh(cwd, [
    'pr', 'view', String(prNumber), '--json',
    'number,url,state,isDraft,mergeable,baseRefName,headRefOid,statusCheckRollup,comments,reviews',
  ]);
  if (r.code !== 0) return null;
  const d = JSON.parse(r.stdout);
  const checks: CheckRun[] = d.statusCheckRollup ?? [];
  const bad = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
  const notMarker = (body: string) => !body.includes(FACTORY_MARKER);
  return {
    number: d.number,
    url: d.url,
    state: d.state,
    isDraft: d.isDraft,
    mergeable: d.mergeable,
    baseRefName: d.baseRefName,
    headRefOid: d.headRefOid,
    failingChecks: checks
      .filter((c) => bad.has((c.conclusion ?? c.state ?? '').toUpperCase()))
      .map((c) => ({ name: c.name ?? c.context ?? 'check', url: c.detailsUrl ?? c.targetUrl ?? null })),
    pendingChecks: checks
      .filter((c) => ['IN_PROGRESS', 'QUEUED', 'PENDING', 'WAITING'].includes((c.status ?? c.state ?? '').toUpperCase()))
      .map((c) => c.name ?? c.context ?? 'check'),
    comments: (d.comments ?? [])
      .filter((c: { body: string }) => notMarker(c.body))
      .map((c: { author?: { login: string }; body: string; createdAt: string }) => ({
        author: c.author?.login ?? 'unknown',
        body: c.body,
        createdAt: c.createdAt,
      })),
    reviews: (d.reviews ?? [])
      .filter((c: { body: string; state: string }) => notMarker(c.body) && (c.body.trim() || c.state === 'CHANGES_REQUESTED'))
      .map((c: { author?: { login: string }; state: string; body: string }) => ({
        author: c.author?.login ?? 'unknown',
        state: c.state,
        body: c.body,
      })),
  };
}

export interface ReviewThread {
  path: string;
  line: number | null;
  outdated: boolean;
  comments: { author: string; body: string }[];
}

export async function unresolvedThreads(cwd: string, prNumber: number): Promise<ReviewThread[] | null> {
  const repo = await gh(cwd, ['repo', 'view', '--json', 'owner,name']);
  if (repo.code !== 0) return null;
  const { owner, name } = JSON.parse(repo.stdout) as { owner: { login: string }; name: string };
  const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved isOutdated path line comments(first:30){nodes{author{login} body}}}}}}}`;
  const r = await gh(cwd, [
    'api', 'graphql', '-f', `query=${query}`, '-F', `owner=${owner.login}`, '-F', `name=${name}`, '-F', `number=${prNumber}`,
  ]);
  if (r.code !== 0) return null;
  const nodes = JSON.parse(r.stdout)?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
  return nodes
    .filter((t: { isResolved: boolean }) => !t.isResolved)
    .map((t: { path: string; line: number | null; isOutdated: boolean; comments: { nodes: { author?: { login: string }; body: string }[] } }) => ({
      path: t.path,
      line: t.line,
      outdated: t.isOutdated,
      comments: t.comments.nodes
        .filter((c) => !c.body.includes(FACTORY_MARKER))
        .map((c) => ({ author: c.author?.login ?? 'unknown', body: c.body })),
    }))
    .filter((t: ReviewThread) => t.comments.length > 0);
}

/** Last lines of a failed GitHub Actions job log, when the check links to one. */
export async function failedLog(cwd: string, url: string | null): Promise<string | null> {
  const m = url?.match(/\/actions\/runs\/(\d+)/);
  if (!m) return null;
  const r = await gh(cwd, ['run', 'view', m[1], '--log-failed'], undefined, 90_000);
  if (r.code !== 0) return null;
  return r.stdout.split('\n').slice(-120).join('\n');
}
