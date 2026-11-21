import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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
  /** Called with every chunk of combined output (for live logs). */
  onOutput?: (chunk: string) => void;
  /** Keep at most this many characters of output (tail). */
  maxOutput?: number;
}

/** Runs a command without a shell. Never throws on non-zero exit. */
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

export function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }, 5000).unref();
}

export async function git(cwd: string, args: string[], timeoutMs = 120_000): Promise<ExecResult> {
  return exec('git', args, { cwd, timeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
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
  const r = await git(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin']);
  if (r.code !== 0) return [];
  const names = new Set<string>();
  for (const line of r.stdout.split('\n')) {
    const n = line.trim();
    if (!n || n === 'origin/HEAD' || n === 'origin') continue;
    names.add(n.startsWith('origin/') ? n.slice('origin/'.length) : n);
  }
  return [...names].filter((n) => !n.startsWith('factory/')).sort();
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

/**
 * The ref a new branch should start from. Prefers a freshly fetched
 * `origin/<branch>` so work starts from what is actually upstream.
 */
export async function resolveBaseRef(repo: string, branch: string): Promise<string> {
  if (await remoteUrl(repo)) {
    await git(repo, ['fetch', '--quiet', 'origin', branch], 60_000);
    if (await refExists(repo, `origin/${branch}`)) return `origin/${branch}`;
  }
  if (await refExists(repo, branch)) return branch;
  throw new Error(`base branch "${branch}" not found in ${repo}`);
}

/** Creates (or reuses) a worktree for `branch`. Returns true when it was created now. */
export async function ensureWorktree(repo: string, worktree: string, branch: string, baseRef: string): Promise<boolean> {
  if (fs.existsSync(path.join(worktree, '.git'))) {
    const current = (await git(worktree, ['branch', '--show-current'])).stdout.trim();
    if (current === branch) return false;
    throw new Error(`worktree ${worktree} is on ${current || 'a detached HEAD'}, expected ${branch}`);
  }
  await git(repo, ['worktree', 'prune']);
  fs.mkdirSync(path.dirname(worktree), { recursive: true });
  const args = (await branchExists(repo, branch))
    ? ['worktree', 'add', worktree, branch]
    : ['worktree', 'add', '--no-track', '-b', branch, worktree, baseRef];
  await gitOut(repo, args);
  return true;
}

/** Removes a factory worktree and its local branch. Only touches `factory/*` branches. */
export async function removeWorktree(repo: string, worktree: string | null, branch: string | null): Promise<void> {
  if (worktree && fs.existsSync(worktree)) {
    await git(repo, ['worktree', 'remove', '--force', worktree]);
    if (fs.existsSync(worktree)) fs.rmSync(worktree, { recursive: true, force: true });
  }
  await git(repo, ['worktree', 'prune']);
  if (branch && branch.startsWith('factory/') && (await branchExists(repo, branch))) {
    await git(repo, ['branch', '-D', branch]);
  }
}

export async function commitsAhead(worktree: string, base: string): Promise<number> {
  const r = await git(worktree, ['rev-list', '--count', `${base}..HEAD`]);
  return r.code === 0 ? Number(r.stdout.trim()) : 0;
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

export async function push(worktree: string, branch: string): Promise<ExecResult> {
  return git(worktree, ['push', '--quiet', '-u', 'origin', `${branch}:${branch}`], 180_000);
}
