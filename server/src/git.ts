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

export function fetchOrigin(repo: string, opts: { cwd?: string; ref?: string } = {}): Promise<ExecResult> {
  return withRepoLock(repo, () => git(opts.cwd ?? repo, ['fetch', '--quiet', 'origin', ...(opts.ref ? [opts.ref] : [])], 120_000));
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
    await fetchOrigin(repo, { ref: branch });
    if (await refExists(repo, `origin/${branch}`)) return `origin/${branch}`;
  }
  if (await refExists(repo, branch)) return branch;
  throw new Error(`base branch "${branch}" not found in ${repo}`);
}

export async function ensureWorktree(repo: string, worktree: string, branch: string, baseRef: string): Promise<boolean> {
  if (fs.existsSync(path.join(worktree, '.git'))) {
    const current = (await git(worktree, ['branch', '--show-current'])).stdout.trim();
    if (current === branch) return false;
    throw new Error(`worktree ${worktree} is on ${current || 'a detached HEAD'}, expected ${branch}`);
  }
  return withRepoLock(repo, async () => {
    await git(repo, ['worktree', 'prune']);
    fs.mkdirSync(path.dirname(worktree), { recursive: true });
    const args = (await branchExists(repo, branch))
      ? ['worktree', 'add', worktree, branch]
      : ['worktree', 'add', '--no-track', '-b', branch, worktree, baseRef];
    await gitOut(repo, args);
    return true;
  });
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
  if ((await git(worktree, ['merge-base', '--is-ancestor', start, 'HEAD'])).code === 0) return [];
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
