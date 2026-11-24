import fs from 'node:fs';
import path from 'node:path';
import * as gitx from '../git.ts';
import { slugify } from './plan.ts';

export interface BaseCheckout {
  dir: string;
  /** The ref the checkout was cut from: `origin/<branch>` after a fetch, or the local branch when there is no origin. */
  ref: string;
  sha: string;
}

export interface BaseCheckoutOptions {
  heavy?: gitx.HeavyWork;
  /** Gitignored files to copy from the main checkout (`.env`), as into ticket worktrees. */
  copyFiles?: string[];
  /** Directories agents are running in now; a checkout one of them is inside is never moved or removed. */
  inUse?: () => Promise<string[]>;
  /** A checkout handed out within this long counts as in use: its agent may not have started yet. */
  keepMs?: number;
}

const DEFAULT_KEEP_MS = 10 * 60_000;
const MOVE_TIMEOUT_MS = 10 * 60_000;
// slugify never produces `@`, so `main@1` can't be taken for a checkout of `main-v2`.
const SEPARATOR = '@';
const locks = new Map<string, Promise<unknown>>();

/**
 * A read-only checkout of the base branch as origin has it now, for the steps that read the repo
 * without a ticket worktree (plan, plan review, the plan's arbiter, steer). The owner's main checkout
 * can be many commits behind origin, on another branch, or carry local edits, while ticket worktrees
 * are cut from origin: a plan read from the main checkout can name code the builders never see.
 * Each branch has one checkout under `root`, shared by every initiative, moved to the new commit
 * when the branch moves. Only while an agent reads it is a second one cut; it goes once idle.
 */
export async function baseCheckout(repoDir: string, root: string, branch: string, opts: BaseCheckoutOptions = {}): Promise<BaseCheckout> {
  const ref = await gitx.resolveBaseRef(repoDir, branch);
  const sha = await gitx.revParse(repoDir, ref);
  if (!sha) throw new Error(`${ref} does not resolve to a commit in ${repoDir}`);
  const slug = slugify(branch, 40);
  const dir = await serialized(path.join(root, slug), async () => {
    const checkouts = branchCheckouts(root, slug);
    const dir = (await atCommit(repoDir, checkouts, sha, opts)) ?? (await moveIdle(repoDir, checkouts, sha, opts)) ?? (await addCheckout(repoDir, root, slug, checkouts, sha, opts));
    const now = new Date();
    fs.utimesSync(dir, now, now);
    await removeIdle(repoDir, checkouts.filter((d) => d !== dir), opts).catch((err) => console.warn('[base-checkout]', (err as Error).message));
    return dir;
  });
  return { dir, ref, sha };
}

function serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
  const run = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
  const tail = run.finally(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  locks.set(key, tail);
  return run;
}

function branchCheckouts(root: string, slug: string): string[] {
  if (!fs.existsSync(root)) return [];
  // `<slug>-<12 hex>` is how checkouts were named when each base commit had its own.
  const name = new RegExp(`^${slug}(${SEPARATOR}\\d+|-[0-9a-f]{12})$`);
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && name.test(e.name))
    .map((e) => path.join(root, e.name));
}

async function headOf(dir: string): Promise<string | null> {
  if (!fs.existsSync(path.join(dir, '.git'))) return null;
  await gitx.waitForEarlierCheckout(dir);
  return gitx.revParse(dir, 'HEAD');
}

async function atCommit(repoDir: string, checkouts: string[], sha: string, opts: BaseCheckoutOptions): Promise<string | null> {
  for (const dir of checkouts) {
    if ((await headOf(dir)) !== sha) continue;
    if (await gitx.finishCheckout(dir, opts.heavy)) await copyLocal(repoDir, dir, opts);
    return dir;
  }
  return null;
}

async function moveIdle(repoDir: string, checkouts: string[], sha: string, opts: BaseCheckoutOptions): Promise<string | null> {
  const heavy = opts.heavy ?? ((work) => work());
  const busy = await busyCheckouts(checkouts, opts);
  for (const dir of checkouts.filter((d) => !busy.has(d))) {
    if (!(await headOf(dir))) continue;
    const moved = await heavy(() => gitx.git(dir, ['checkout', '--detach', '--force', '--quiet', sha], MOVE_TIMEOUT_MS));
    if (moved.code !== 0) {
      console.warn('[base-checkout]', `could not move ${dir} to ${sha.slice(0, 12)}: ${(moved.stderr || moved.stdout).trim()}`);
      continue;
    }
    await copyLocal(repoDir, dir, opts);
    return dir;
  }
  return null;
}

async function addCheckout(repoDir: string, root: string, slug: string, checkouts: string[], sha: string, opts: BaseCheckoutOptions): Promise<string> {
  const taken = new Set(checkouts.map((d) => path.basename(d)));
  let n = 1;
  while (taken.has(`${slug}${SEPARATOR}${n}`)) n++;
  const dir = path.join(root, `${slug}${SEPARATOR}${n}`);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  await gitx.withRepoLock(repoDir, async () => {
    await gitx.git(repoDir, ['worktree', 'prune']);
    fs.mkdirSync(root, { recursive: true });
    const add = await gitx.git(repoDir, ['worktree', 'add', '--detach', '--no-checkout', dir, sha]);
    if (add.code !== 0) throw new Error(`could not add a checkout of ${sha.slice(0, 12)} at ${dir}: ${(add.stderr || add.stdout).trim()}`);
  });
  await gitx.checkOutAgain(dir, opts.heavy);
  await copyLocal(repoDir, dir, opts);
  return dir;
}

async function copyLocal(repoDir: string, dir: string, opts: BaseCheckoutOptions): Promise<void> {
  await gitx.copyWorktreeIncludes(repoDir, dir);
  if (opts.copyFiles?.length) await gitx.copyLocalFiles(repoDir, dir, opts.copyFiles);
}

async function busyCheckouts(checkouts: string[], opts: BaseCheckoutOptions): Promise<Set<string>> {
  if (!checkouts.length) return new Set();
  const keepMs = opts.keepMs ?? DEFAULT_KEEP_MS;
  const cwds = (await opts.inUse?.()) ?? [];
  return new Set(
    checkouts.filter((d) => Date.now() - fs.statSync(d).mtimeMs < keepMs || cwds.some((cwd) => cwd === d || cwd.startsWith(d + path.sep))),
  );
}

async function removeIdle(repoDir: string, others: string[], opts: BaseCheckoutOptions): Promise<void> {
  const busy = await busyCheckouts(others, opts);
  for (const d of others.filter((o) => !busy.has(o))) await gitx.removeWorktree(repoDir, d, null);
}
