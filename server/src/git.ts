import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { repoShellEnv } from './shell-env.ts';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  input?: string;
  onOutput?: (chunk: string) => void;
  maxOutput?: number;
}

export function exec(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  const max = opts.maxOutput ?? 2_000_000;
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killTree(child.pid);
        }, opts.timeoutMs)
      : null;
    child.stdout.on('data', (d: Buffer) => {
      const s = d.toString();
      stdout = (stdout + s).slice(-max);
      opts.onOutput?.(s);
    });
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString();
      stderr = (stderr + s).slice(-max);
      opts.onOutput?.(s);
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: stderr + String(err), timedOut });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, timedOut });
    });
    if (opts.input) child.stdin.write(opts.input);
    child.stdin.end();
  });
}

function trySignal(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

export function killTree(pid: number | undefined): void {
  if (!pid) return;
  const processGroup = -pid;
  if (!trySignal(processGroup, 'SIGTERM')) trySignal(pid, 'SIGTERM');
  setTimeout(() => trySignal(processGroup, 'SIGKILL'), 5000).unref();
}

export function runInNonLoginShell(command: string, opts: ExecOptions): Promise<ExecResult> {
  return exec('bash', ['-c', command], opts);
}

export function commandCouldNotRun(exitCode: number): boolean {
  const notExecutable = 126;
  const notFound = 127;
  return exitCode === notExecutable || exitCode === notFound;
}

export async function git(cwd: string, args: string[], timeoutMs = 120_000): Promise<ExecResult> {
  return exec('git', args, { cwd, timeoutMs, env: { ...repoShellEnv(), GIT_TERMINAL_PROMPT: '0' } });
}

const repoLocks = new Map<string, Promise<unknown>>();

export function withRepoLock<T>(repo: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(repo);
  const result = (repoLocks.get(key) ?? Promise.resolve()).then(fn);
  const settled = result.catch(() => undefined);
  repoLocks.set(key, settled);
  void settled.then(() => {
    if (repoLocks.get(key) === settled) repoLocks.delete(key);
  });
  return result;
}

const fetchesNotStartedYet = new Map<string, Promise<ExecResult>>();

export function fetchOrigin(repo: string, opts: { cwd?: string; refs?: string[] } = {}): Promise<ExecResult> {
  const cwd = opts.cwd ?? repo;
  const refs = opts.refs ?? [];
  const sameFetch = JSON.stringify([path.resolve(repo), path.resolve(cwd), refs]);
  const waitingForTheRepo = fetchesNotStartedYet.get(sameFetch);
  if (waitingForTheRepo) return waitingForTheRepo;
  const fetch = withRepoLock(repo, () => {
    fetchesNotStartedYet.delete(sameFetch);
    return git(cwd, ['fetch', '--quiet', 'origin', ...refs], 120_000);
  });
  fetchesNotStartedYet.set(sameFetch, fetch);
  return fetch;
}

export function trackingRefspec(branch: string): string {
  return `+refs/heads/${branch}:refs/remotes/origin/${branch}`;
}

async function gitOut(cwd: string, args: string[]): Promise<string> {
  const r = await git(cwd, args);
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

export async function isGitRepo(dir: string): Promise<boolean> {
  if (!fs.existsSync(dir)) return false;
  const r = await git(dir, ['rev-parse', '--show-toplevel']);
  return r.code === 0 && path.resolve(r.stdout.trim()) === path.resolve(fs.realpathSync(dir));
}

export async function remoteUrl(repo: string): Promise<string | null> {
  const r = await git(repo, ['remote', 'get-url', 'origin']);
  return r.code === 0 ? r.stdout.trim() : null;
}

export function isGithubUrl(url: string | null): boolean {
  return !!url && /github\.com[:/]/.test(url);
}

export async function listBranches(repo: string): Promise<string[]> {
  const r = await git(repo, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin']);
  if (r.code !== 0) return [];
  const names = new Set<string>();
  for (const line of r.stdout.split('\n')) {
    const n = line.trim();
    if (!n || n === 'origin/HEAD' || n === 'origin') continue;
    names.add(n.startsWith('origin/') ? n.slice('origin/'.length) : n);
  }
  return [...names].filter((n) => !n.startsWith('factory/'));
}

export async function detectDefaultBranch(repo: string): Promise<string> {
  const head = await git(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (head.code === 0 && head.stdout.trim()) return head.stdout.trim().replace(/^origin\//, '');
  for (const b of ['main', 'master']) {
    if ((await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`])).code === 0) return b;
  }
  return (await git(repo, ['branch', '--show-current'])).stdout.trim() || 'main';
}

export async function branchExists(repo: string, branch: string): Promise<boolean> {
  return (await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).code === 0;
}

export async function refExists(repo: string, ref: string): Promise<boolean> {
  return (await git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).code === 0;
}

export async function resolveBaseRef(repo: string, branch: string): Promise<string> {
  if (await remoteUrl(repo)) {
    await fetchOrigin(repo, { refs: [branch] });
    if (await refExists(repo, `origin/${branch}`)) return `origin/${branch}`;
  }
  if (await refExists(repo, branch)) return branch;
  throw new Error(`base branch "${branch}" not found in ${repo}`);
}

const CHECKOUT_TIMEOUT_MS = 10 * 60_000;
const NO_COMMIT = '0'.repeat(40);

async function filesCheckedOut(worktree: string): Promise<boolean> {
  const index = await git(worktree, ['rev-parse', '--git-path', 'index']);
  const notAWorktreeToFinish = index.code !== 0;
  return notAWorktreeToFinish || fs.existsSync(path.resolve(worktree, index.stdout.trim()));
}

const checkoutOf = (worktree: string) => ['-C', worktree, 'reset', '--hard', '--quiet', '--no-recurse-submodules'];

async function checkoutRunning(worktree: string): Promise<boolean> {
  const processes = await exec('ps', ['-A', '-ww', '-o', 'command='], { timeoutMs: 10_000 });
  return processes.stdout.includes(checkoutOf(worktree).join(' '));
}

export async function waitForEarlierCheckout(worktree: string, pollMs = 500): Promise<boolean> {
  let waited = false;
  for (const deadline = Date.now() + CHECKOUT_TIMEOUT_MS; (await checkoutRunning(worktree)) && Date.now() < deadline; waited = true) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return waited;
}

async function checkOutFiles(worktree: string): Promise<void> {
  const reset = await git(worktree, checkoutOf(worktree), CHECKOUT_TIMEOUT_MS);
  if (reset.code !== 0) throw new Error(`could not check out ${worktree}: ${(reset.stderr || reset.stdout).trim()}`);
  const hook = await git(worktree, ['hook', 'run', '--ignore-missing', 'post-checkout', '--', NO_COMMIT, (await headSha(worktree)) ?? NO_COMMIT, '1'], CHECKOUT_TIMEOUT_MS);
  const gitHasNoHookCommand = /is not a git command/.test(hook.stderr);
  if (hook.code !== 0 && !gitHasNoHookCommand) throw new Error(`post-checkout hook failed in ${worktree}: ${(hook.stderr || hook.stdout).trim()}`);
}

export type HeavyWork = <T>(work: () => Promise<T>) => Promise<T>;

export function checkOutAgain(worktree: string, heavy: HeavyWork = (work) => work()): Promise<void> {
  return heavy(() => checkOutFiles(worktree));
}

async function indexLockLeftBehind(worktree: string): Promise<boolean> {
  const lock = await git(worktree, ['rev-parse', '--git-path', 'index.lock']);
  return lock.code !== 0 || fs.existsSync(path.resolve(worktree, lock.stdout.trim()));
}

export async function untouchedWorktreeBranch(repo: string, worktree: string, baseRef: string): Promise<string | null> {
  if (!fs.existsSync(path.join(worktree, '.git'))) return null;
  const branch = (await git(worktree, ['branch', '--show-current'])).stdout.trim();
  const head = await revParse(worktree, 'HEAD');
  const stillAtItsBase = !!branch && !!head && head === (await revParse(repo, baseRef));
  return stillAtItsBase && !(await indexLockLeftBehind(worktree)) ? branch : null;
}

export async function finishCheckout(worktree: string, heavy: HeavyWork = (work) => work()): Promise<boolean> {
  if (await filesCheckedOut(worktree)) return false;
  await heavy(() => checkOutFiles(worktree));
  return true;
}

export async function ensureWorktree(repo: string, worktree: string, branch: string, baseRef: string, heavy: HeavyWork = (work) => work()): Promise<boolean> {
  if (fs.existsSync(path.join(worktree, '.git'))) {
    const current = (await git(worktree, ['branch', '--show-current'])).stdout.trim();
    if (current !== branch) throw new Error(`worktree ${worktree} is on ${current || 'a detached HEAD'}, expected ${branch}`);
    return finishCheckout(worktree, heavy);
  }
  await withRepoLock(repo, async () => {
    await git(repo, ['worktree', 'prune']);
    fs.mkdirSync(path.dirname(worktree), { recursive: true });
    const args = (await branchExists(repo, branch))
      ? ['worktree', 'add', '--no-checkout', worktree, branch]
      : ['worktree', 'add', '--no-checkout', '--no-track', '-b', branch, worktree, baseRef];
    await gitOut(repo, args);
  });
  await heavy(() => checkOutFiles(worktree));
  return true;
}

const MAX_WORKTREE_INCLUDES = 500;

export async function copyWorktreeIncludes(repo: string, worktree: string): Promise<string[]> {
  const includeFile = path.join(repo, '.worktreeinclude');
  if (!fs.existsSync(includeFile)) return [];
  const r = await git(repo, ['ls-files', '--others', '--ignored', `--exclude-from=${includeFile}`]);
  if (r.code !== 0) throw new Error(`.worktreeinclude: ${(r.stderr || r.stdout).trim()}`);
  const files = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  if (files.length > MAX_WORKTREE_INCLUDES) {
    throw new Error(`.worktreeinclude matches ${files.length} files; name the files you need, not whole dependency folders`);
  }
  for (const f of files) {
    const target = path.join(worktree, f);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repo, f), target);
  }
  return files;
}

export function isSafeRelativePath(file: string): boolean {
  const normalized = path.normalize(file);
  return !!file.trim() && !path.isAbsolute(normalized) && normalized !== '..' && !normalized.startsWith(`..${path.sep}`);
}

export async function ignoredFiles(repo: string, files: string[]): Promise<string[]> {
  if (!files.length) return [];
  const r = await git(repo, ['check-ignore', '--', ...files]);
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

export async function copyLocalFiles(repo: string, worktree: string, files: string[]): Promise<{ copied: string[]; skipped: string[] }> {
  const present = files.filter((f) => isSafeRelativePath(f) && fs.existsSync(path.join(repo, f)));
  const ignored = new Set(await ignoredFiles(repo, present));
  const copied = present.filter((f) => ignored.has(f));
  for (const f of copied) {
    const target = path.join(worktree, f);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repo, f), target);
  }
  return { copied, skipped: files.filter((f) => !copied.includes(f)) };
}

export async function resetHard(worktree: string, ref: string): Promise<void> {
  await gitOut(worktree, ['reset', '--hard', '--quiet', ref]);
}

export function removeWorktree(repo: string, worktree: string | null, branch: string | null): Promise<void> {
  return withRepoLock(repo, async () => {
    if (worktree && fs.existsSync(worktree)) {
      await git(repo, ['worktree', 'remove', '--force', worktree]);
      if (fs.existsSync(worktree)) fs.rmSync(worktree, { recursive: true, force: true });
    }
    await git(repo, ['worktree', 'prune']);
    if (branch && branch.startsWith('factory/') && (await branchExists(repo, branch))) {
      await git(repo, ['branch', '-D', branch]);
    }
  });
}

export async function commitsAhead(worktree: string, base: string): Promise<number> {
  const r = await git(worktree, ['rev-list', '--count', `${base}..HEAD`]);
  return r.code === 0 ? Number(r.stdout.trim()) : 0;
}

/**
 * Puts the worktree's current tree on top of `onto` (an earlier head of the same remote branch) as one
 * commit whose parents are HEAD and `onto`, and moves the branch there. The push that follows is a
 * fast-forward, so nothing pushed before is rewritten, and the branch's diff is exactly the new tree.
 * Returns the new commit, or null when `onto` is already in HEAD's history (a plain push works).
 */
export async function carryTreeOnto(worktree: string, onto: string, message: string): Promise<string | null> {
  const head = await revParse(worktree, 'HEAD');
  const earlier = await revParse(worktree, onto);
  if (!head || !earlier || (await isAncestor(worktree, earlier, head))) return null;
  const tree = await gitOut(worktree, ['rev-parse', 'HEAD^{tree}']);
  const commit = await gitOut(worktree, ['commit-tree', tree, '-p', head, '-p', earlier, '-m', message]);
  await gitOut(worktree, ['merge', '--ff-only', '--quiet', commit]);
  return commit;
}

export async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  return (await git(cwd, ['merge-base', '--is-ancestor', ancestor, descendant])).code === 0;
}

async function everPointedAt(cwd: string, ref: string, sha: string): Promise<boolean> {
  const r = await git(cwd, ['reflog', 'show', '--format=%H', ref]);
  return r.code === 0 && r.stdout.split('\n').includes(sha);
}

export type CatchUp = 'current' | 'fast-forwarded' | 'followed-rewrite' | 'ahead' | 'diverged';

export async function catchUpWith(worktree: string, remoteRef: string): Promise<CatchUp> {
  const [head, remote] = await Promise.all([headSha(worktree), revParse(worktree, remoteRef)]);
  if (!head || !remote) return 'diverged';
  if (head === remote) return 'current';
  if (await isAncestor(worktree, head, remote)) {
    await gitOut(worktree, ['merge', '--ff-only', '--quiet', remote]);
    return 'fast-forwarded';
  }
  if (await isAncestor(worktree, remote, head)) return 'ahead';
  if (!(await everPointedAt(worktree, remoteRef, head))) return 'diverged';
  await resetHard(worktree, remote);
  return 'followed-rewrite';
}

async function lines(cwd: string, args: string[]): Promise<string[]> {
  return (await gitOut(cwd, args)).split('\n').filter(Boolean);
}

async function ownCommitMessage(worktree: string, start: string, rewritten: string[], fallback: string): Promise<string> {
  const own = (await lines(worktree, ['log', '--reverse', '--no-merges', '--format=%H %s', `${start}..HEAD`]))
    .map((line) => ({ sha: line.slice(0, line.indexOf(' ')), subject: line.slice(line.indexOf(' ') + 1) }))
    .filter((c) => !rewritten.includes(c.subject));
  if (own.length === 0) return fallback;
  if (own.length === 1) return gitOut(worktree, ['log', '-1', '--format=%B', own[0].sha]);
  return [own[0].subject, '', ...own.slice(1).map((c) => `- ${c.subject}`)].join('\n');
}

export async function restoreHistoryFrom(worktree: string, start: string, fallbackMessage: string): Promise<string[]> {
  if (await isAncestor(worktree, start, 'HEAD')) return [];
  const rewritten = await lines(worktree, ['log', '--format=%s', `HEAD..${start}`]);
  const message = await ownCommitMessage(worktree, start, rewritten, fallbackMessage);
  await gitOut(worktree, ['reset', '--soft', '--quiet', start]);
  if ((await git(worktree, ['diff', '--cached', '--quiet'])).code !== 0) {
    await gitOut(worktree, ['commit', '--quiet', '--no-verify', '-m', message]);
  }
  return rewritten;
}

export async function statusPorcelain(worktree: string): Promise<string> {
  return (await git(worktree, ['status', '--porcelain'])).stdout.trim();
}

export async function headSha(worktree: string): Promise<string | null> {
  const r = await git(worktree, ['rev-parse', 'HEAD']);
  return r.code === 0 ? r.stdout.trim() : null;
}

export interface WorktreeState {
  head: string | null;
  tracked: string;
}

export async function worktreeState(cwd: string): Promise<WorktreeState> {
  const status = await git(cwd, ['status', '--porcelain', '--untracked-files=no']);
  return { head: await headSha(cwd), tracked: status.stdout.trim() };
}

export function worktreeChanges(before: WorktreeState, after: WorktreeState): string[] {
  const changes: string[] = [];
  if (before.head !== after.head) changes.push(`HEAD moved from ${before.head?.slice(0, 7) ?? 'none'} to ${after.head?.slice(0, 7) ?? 'none'}`);
  if (before.tracked !== after.tracked) changes.push('tracked files or the index changed');
  return changes;
}

export async function revParse(cwd: string, ref: string): Promise<string | null> {
  const r = await git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return r.code === 0 ? r.stdout.trim() : null;
}

export async function trackedFiles(repo: string, branch: string): Promise<string[] | null> {
  const ref = (await refExists(repo, `origin/${branch}`)) ? `origin/${branch}` : branch;
  const r = await exec('git', ['ls-tree', '-r', '--name-only', ref], { cwd: repo, timeoutMs: 30_000, maxOutput: 50_000_000, env: { ...repoShellEnv(), GIT_TERMINAL_PROMPT: '0' } });
  return r.code === 0 ? r.stdout.split('\n').filter(Boolean) : null;
}

const LOCKFILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'poetry.lock',
  'uv.lock',
  'Pipfile.lock',
  'Cargo.lock',
  'go.sum',
  'Gemfile.lock',
  'composer.lock',
]);
const TEST_PATH = /(^|\/)(tests?|__tests__|__snapshots__|spec)\/|\.(test|spec)\.[^/]+$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$/;

export function countsTowardSize(file: string): boolean {
  return !LOCKFILES.has(path.posix.basename(file)) && !TEST_PATH.test(file);
}

export function linesInNumstat(numstat: string, generated: Set<string>): number {
  let total = 0;
  for (const line of numstat.split('\n')) {
    const [added, deleted, file] = line.split('\t');
    if (!file || added === '-' || generated.has(file) || !countsTowardSize(file)) continue;
    total += Number(added) + Number(deleted);
  }
  return total;
}

async function generatedFiles(cwd: string, files: string[]): Promise<Set<string>> {
  if (!files.length) return new Set();
  const r = await git(cwd, ['check-attr', '-z', 'linguist-generated', '--', ...files]);
  const fields = r.stdout.split('\0');
  const generated = new Set<string>();
  for (let i = 0; i + 2 < fields.length; i += 3) if (['set', 'true'].includes(fields[i + 2])) generated.add(fields[i]);
  return generated;
}

export async function diffLines(worktree: string, base: string): Promise<number | null> {
  const r = await git(worktree, ['diff', '--numstat', '--no-renames', `${base}...HEAD`]);
  if (r.code !== 0) return null;
  const files = r.stdout.split('\n').map((line) => line.split('\t')[2]).filter(Boolean);
  return linesInNumstat(r.stdout, await generatedFiles(worktree, files));
}

export async function diffStat(worktree: string, base: string): Promise<string> {
  return (await git(worktree, ['diff', '--stat', `${base}...HEAD`])).stdout.trim();
}

export async function mergeInto(worktree: string, ref: string): Promise<{ ok: boolean; output: string }> {
  const r = await git(worktree, ['merge', '--no-edit', ref]);
  if (r.code !== 0) {
    await git(worktree, ['merge', '--abort']);
    return { ok: false, output: (r.stdout + r.stderr).trim() };
  }
  return { ok: true, output: r.stdout.trim() };
}

export async function push(worktree: string, branch: string, remoteBranch = branch): Promise<ExecResult> {
  return git(worktree, ['push', '--quiet', '-u', 'origin', `${branch}:${remoteBranch}`], 180_000);
}
