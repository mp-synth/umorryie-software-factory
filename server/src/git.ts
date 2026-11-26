import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { discardDir } from './discard.ts';
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
  pipeCloseTimeoutMs?: number;
}

// A descendant can inherit stdout or stderr after the command itself exits. Do not wait forever for `close`.
const WAIT_FOR_PIPES_AFTER_EXIT_MS = 10_000;
const GIVE_UP_AFTER_KILL_MS = 10_000;

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
    let settled = false;
    let exited = false;
    let exitCode = 1;
    let pipeWait: NodeJS.Timeout | null = null;
    let killWait: NodeJS.Timeout | null = null;
    const stopTimers = () => {
      if (timer) clearTimeout(timer);
      if (pipeWait) clearTimeout(pipeWait);
      if (killWait) clearTimeout(killWait);
    };
    const finish = (code: number, message = '') => {
      if (settled) return;
      settled = true;
      stopTimers();
      resolve({ code, stdout, stderr: message ? `${stderr}${stderr ? '\n' : ''}${message}` : stderr, timedOut });
    };
    const closePipes = () => {
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const noteExit = (code: number | null) => {
      if (exited) return;
      exited = true;
      exitCode = code ?? 1;
      if (timer) clearTimeout(timer);
      if (killWait) clearTimeout(killWait);
      pipeWait = setTimeout(() => {
        closePipes();
        finish(exitCode, '(output pipes remained open after the command exited)');
      }, opts.pipeCloseTimeoutMs ?? WAIT_FOR_PIPES_AFTER_EXIT_MS);
      pipeWait.unref();
    };
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          if (child.exitCode !== null || child.signalCode !== null) {
            noteExit(child.exitCode);
            return;
          }
          timedOut = true;
          killTree(child.pid);
          killWait = setTimeout(() => {
            closePipes();
            finish(124, '(timed out; the process did not exit after it was killed)');
          }, GIVE_UP_AFTER_KILL_MS);
          killWait.unref();
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
      stderr += String(err);
      finish(127);
    });
    child.on('exit', noteExit);
    child.on('close', (code) => {
      noteExit(code);
      finish(exitCode);
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
export const REPO_LOCK_WAIT_MS = 5 * 60_000;

export class RepoBusy extends Error {}

/**
 * Runs `fn` alone among this repo's git bookkeeping. A caller that waits longer than `waitMs` gets RepoBusy
 * instead of queueing behind a hung command forever; its work never runs.
 */
export function withRepoLock<T>(repo: string, fn: () => Promise<T>, waitMs = REPO_LOCK_WAIT_MS): Promise<T> {
  const key = path.resolve(repo);
  const before = repoLocks.get(key) ?? Promise.resolve();
  let gaveUp = false;
  const turn = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      gaveUp = true;
      reject(new RepoBusy(`waited ${Math.round(waitMs / 1000)} s for other git work in ${repo}`));
    }, waitMs);
    timer.unref();
    void before.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
  const result = turn.then(() => (gaveUp ? Promise.reject(new RepoBusy('gave up waiting')) : fn()));
  const settled = before.then(() => result).catch(() => undefined);
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
  const forget = () => {
    if (fetchesNotStartedYet.get(sameFetch) === fetch) fetchesNotStartedYet.delete(sameFetch);
  };
  fetch.then(forget, forget);
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

export async function worktreeIncludeFiles(repo: string): Promise<string[]> {
  const includeFile = path.join(repo, '.worktreeinclude');
  if (!fs.existsSync(includeFile)) return [];
  const r = await git(repo, ['ls-files', '--others', '--ignored', `--exclude-from=${includeFile}`]);
  if (r.code !== 0) throw new Error(`.worktreeinclude: ${(r.stderr || r.stdout).trim()}`);
  const files = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  if (files.length > MAX_WORKTREE_INCLUDES) {
    throw new Error(`.worktreeinclude matches ${files.length} files; name the files you need, not whole dependency folders`);
  }
  return files;
}

export async function copyWorktreeIncludes(repo: string, worktree: string): Promise<string[]> {
  const files = await worktreeIncludeFiles(repo);
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
      if (fs.existsSync(worktree)) discardDir(worktree);
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

// The commits (by sha) a branch does not have yet; a sha this clone doesn't know is left out, not reported.
export async function findCommitsMissingFromHead(cwd: string, shas: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const sha of shas) if ((await revParse(cwd, sha)) && !(await isAncestor(cwd, sha, 'HEAD'))) missing.push(sha);
  return missing;
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

export async function generatedFiles(cwd: string, files: string[]): Promise<Set<string>> {
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

/** rerere replays a conflict resolution recorded in any worktree of the repo (they share it), so a conflict is resolved once. */
export const RERERE = ['-c', 'rerere.enabled=true', '-c', 'rerere.autoUpdate=true'];

export const FACTORY_EMAIL = 'software-factory@localhost';
/** Merges and commits the factory makes itself carry this identity, so a verifier can tell them from a fixer's. */
const FACTORY_IDENTITY = ['-c', 'user.name=software-factory', '-c', `user.email=${FACTORY_EMAIL}`, '-c', 'commit.gpgsign=false'];

export async function unmergedPaths(worktree: string): Promise<string[]> {
  return (await git(worktree, ['diff', '--name-only', '--diff-filter=U'])).stdout.split('\n').filter(Boolean);
}

export interface MergeOutcome {
  ok: boolean;
  output: string;
  /** Files still conflicting when the merge stopped; empty when it went through. */
  conflicts: string[];
}

/**
 * Merges `ref` into the worktree's branch. A conflict rerere has seen before is resolved and committed; one
 * `resolve` settles (generated files, regenerated) is committed too. Anything else is aborted.
 */
export async function mergeInto(
  worktree: string,
  ref: string,
  resolve?: (conflicts: string[]) => Promise<boolean>,
  opts: { rerere?: boolean } = {},
): Promise<MergeOutcome> {
  const r = await git(worktree, [...(opts.rerere === false ? [] : RERERE), ...FACTORY_IDENTITY, 'merge', '--no-edit', '--no-verify', ref]);
  if (r.code === 0) return { ok: true, output: r.stdout.trim(), conflicts: [] };
  const conflicts = await unmergedPaths(worktree);
  const mergeHead = await git(worktree, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']);
  const mergeInProgress = mergeHead.code === 0;
  const settled = mergeInProgress && (conflicts.length === 0 || (resolve ? await resolve(conflicts) : false));
  if (settled && (await unmergedPaths(worktree)).length === 0) {
    const committed = await git(worktree, [...FACTORY_IDENTITY, 'commit', '--no-edit', '--no-verify', '--quiet']);
    if (committed.code === 0) return { ok: true, output: `${r.stdout.trim()}\nResolved without an agent: ${conflicts.join(', ') || 'recorded resolution'}`, conflicts: [] };
  }
  if (mergeInProgress) await git(worktree, ['merge', '--abort']);
  return { ok: false, output: (r.stdout + r.stderr).trim(), conflicts };
}

/** Whether `ours` and `theirs` merge without conflict, worked out in the object store only (no worktree, no refs). */
export async function mergesCleanly(cwd: string, ours: string, theirs: string): Promise<boolean | null> {
  const r = await git(cwd, ['merge-tree', '--write-tree', '--name-only', '--no-messages', ours, theirs], 60_000);
  if (r.code === 0) return true;
  return r.code === 1 ? false : null;
}

export async function untrackedFiles(worktree: string): Promise<string[]> {
  const r = await git(worktree, ['ls-files', '--others', '--exclude-standard', '-z']);
  return r.code === 0 ? r.stdout.split('\0').filter(Boolean) : [];
}

export async function treeSha(worktree: string): Promise<string | null> {
  const r = await git(worktree, ['rev-parse', 'HEAD^{tree}']);
  return r.code === 0 ? r.stdout.trim() : null;
}

/** Commits whatever the worktree changed, as the factory, without hooks; null when nothing changed. */
export async function commitAll(worktree: string, message: string): Promise<string | null> {
  if (!(await statusPorcelain(worktree))) return null;
  await gitOut(worktree, ['add', '-A']);
  if ((await git(worktree, ['diff', '--cached', '--quiet'])).code === 0) return null;
  await gitOut(worktree, [...FACTORY_IDENTITY, 'commit', '--quiet', '--no-verify', '-m', message]);
  return headSha(worktree);
}

function explicitPathspecs(worktree: string, files: string[]): string[] {
  return [...new Set(files)].map((file) => {
    if (!isSafeRelativePath(file) || file.includes('\0')) throw new Error(`unsafe commit path: ${JSON.stringify(file)}`);
    const absolute = path.join(worktree, file);
    if (fs.existsSync(absolute) && fs.lstatSync(absolute).isDirectory()) throw new Error(`commit path is a directory: ${file}`);
    return `:(literal)${file}`;
  });
}

/** Commits only the named files, leaving every other staged, unstaged, or untracked path alone. */
export async function commitPaths(worktree: string, message: string, files: string[]): Promise<string | null> {
  const paths = explicitPathspecs(worktree, files);
  if (!paths.length) return null;
  await gitOut(worktree, ['add', '-A', '--', ...paths]);
  const changed = await git(worktree, ['diff', '--cached', '--quiet', 'HEAD', '--', ...paths]);
  if (changed.code === 0) return null;
  if (changed.code !== 1) throw new Error(`could not inspect commit paths: ${(changed.stderr || changed.stdout).trim()}`);
  await gitOut(worktree, [...FACTORY_IDENTITY, 'commit', '--quiet', '--no-verify', '--only', '-m', message, '--', ...paths]);
  return headSha(worktree);
}

/** The environment that makes an agent's git commands skip the repo's commit hooks and reuse recorded conflict resolutions. */
export function agentGitEnv(opts: { skipHooks: boolean; emptyHooksDir: string }): Record<string, string> {
  const pairs: [string, string][] = [
    ['rerere.enabled', 'true'],
    ['rerere.autoUpdate', 'true'],
    ...(opts.skipHooks ? ([['core.hooksPath', opts.emptyHooksDir]] as [string, string][]) : []),
  ];
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(pairs.length) };
  pairs.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = key;
    env[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  return env;
}

export async function push(worktree: string, branch: string, remoteBranch = branch): Promise<ExecResult> {
  return git(worktree, ['push', '--quiet', '-u', 'origin', `${branch}:${remoteBranch}`], 180_000);
}
