import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { carryTreeOnto, catchUpWith, checkOutAgain, countsTowardSize, diffLines, ensureWorktree, fetchOrigin, git, linesInNumstat, restoreHistoryFrom, untouchedWorktreeBranch, waitForEarlierCheckout, withRepoLock, worktreeChanges, worktreeState } from './git.ts';

async function run(cwd: string, ...args: string[]): Promise<string> {
  const r = await git(cwd, args);
  assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

async function repoWithBase(): Promise<{ dir: string; base: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-git-'));
  await run(dir, 'init', '--quiet', '--initial-branch=main');
  await run(dir, 'config', 'user.email', 'factory@example.com');
  await run(dir, 'config', 'user.name', 'Factory');
  await commitFile(dir, 'base.txt', 'base\n', 'refactor: the base commit');
  return { dir, base: await run(dir, 'rev-parse', 'HEAD') };
}

async function commitFile(dir: string, file: string, content: string, message: string, ...flags: string[]): Promise<void> {
  fs.writeFileSync(path.join(dir, file), content);
  await run(dir, 'add', file);
  await run(dir, 'commit', '--quiet', ...flags, '-m', message);
}

const subjects = (dir: string, range: string) => run(dir, 'log', '--format=%s', range);

async function pushedFeature(): Promise<{ dir: string; github: string }> {
  const { dir } = await repoWithBase();
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-remote-'));
  await run(remote, 'init', '--quiet', '--bare');
  await run(dir, 'remote', 'add', 'origin', remote);
  await run(dir, 'checkout', '--quiet', '-b', 'feature');
  await commitFile(dir, 'feature.txt', 'feature\n', 'feat: add the feature');
  await run(dir, 'push', '--quiet', '-u', 'origin', 'main', 'feature');
  const github = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-github-'));
  await run(github, 'clone', '--quiet', '--branch', 'feature', remote, '.');
  await run(github, 'config', 'user.email', 'github@example.com');
  await run(github, 'config', 'user.name', 'GitHub');
  return { dir, github };
}

async function rewriteOnGithub(github: string, dir: string): Promise<void> {
  await commitFile(github, 'feature.txt', 'feature, rebased\n', 'feat: add the feature', '--amend');
  await run(github, 'push', '--quiet', '--force', 'origin', 'feature');
  await run(dir, 'fetch', '--quiet', 'origin');
}

const head = (dir: string, ref = 'HEAD') => run(dir, 'rev-parse', ref);

test('leaves a branch alone when the agent only added commits', async () => {
  const { dir, base } = await repoWithBase();
  await commitFile(dir, 'feature.txt', 'feature\n', 'feat: add the feature');
  const head = await run(dir, 'rev-parse', 'HEAD');

  assert.deepEqual(await restoreHistoryFrom(dir, base, 'unused'), []);
  assert.equal(await run(dir, 'rev-parse', 'HEAD'), head);
});

test('puts work amended into the base commit back on top of the base', async () => {
  const { dir, base } = await repoWithBase();
  fs.writeFileSync(path.join(dir, 'feature.txt'), 'feature\n');
  await run(dir, 'add', 'feature.txt');
  await run(dir, 'commit', '--quiet', '--amend', '--no-edit');
  const amendedTree = await run(dir, 'rev-parse', 'HEAD^{tree}');

  assert.deepEqual(await restoreHistoryFrom(dir, base, 'Break down usage per video'), ['refactor: the base commit']);
  assert.equal(await run(dir, 'rev-parse', 'HEAD~1'), base);
  assert.equal(await subjects(dir, `${base}..HEAD`), 'Break down usage per video');
  assert.equal(await run(dir, 'rev-parse', 'HEAD^{tree}'), amendedTree);
  assert.equal(await run(dir, 'status', '--porcelain'), '');
});

test("keeps the agent's own message when it reworded the commit it amended", async () => {
  const { dir, base } = await repoWithBase();
  fs.writeFileSync(path.join(dir, 'feature.txt'), 'feature\n');
  await run(dir, 'add', 'feature.txt');
  await run(dir, 'commit', '--quiet', '--amend', '-m', 'feat: add the feature\n\nWhy it matters.');

  await restoreHistoryFrom(dir, base, 'fallback');
  assert.equal(await run(dir, 'rev-parse', 'HEAD~1'), base);
  assert.equal(await run(dir, 'log', '-1', '--format=%B'), 'feat: add the feature\n\nWhy it matters.');
});

test('restores an earlier round that the agent amended and keeps the new work on top', async () => {
  const { dir } = await repoWithBase();
  await commitFile(dir, 'feature.txt', 'feature\n', 'feat: add the feature');
  const pushed = await run(dir, 'rev-parse', 'HEAD');
  await commitFile(dir, 'feature.txt', 'feature, fixed\n', 'feat: add the feature', '--amend');

  assert.deepEqual(await restoreHistoryFrom(dir, pushed, 'Fix round 2 on the feature'), ['feat: add the feature']);
  assert.equal(await run(dir, 'rev-parse', 'HEAD~1'), pushed);
  assert.equal(await subjects(dir, `${pushed}..HEAD`), 'Fix round 2 on the feature');
  assert.equal(fs.readFileSync(path.join(dir, 'feature.txt'), 'utf8'), 'feature, fixed\n');
});

test('catchUpWith reports a branch that matches its remote', async () => {
  const { dir } = await pushedFeature();
  assert.equal(await catchUpWith(dir, 'origin/feature'), 'current');
});

test('catchUpWith fast-forwards to commits pushed by someone else', async () => {
  const { dir, github } = await pushedFeature();
  await commitFile(github, 'more.txt', 'more\n', 'feat: more');
  await run(github, 'push', '--quiet', 'origin', 'feature');
  await run(dir, 'fetch', '--quiet', 'origin');

  assert.equal(await catchUpWith(dir, 'origin/feature'), 'fast-forwarded');
  assert.equal(await head(dir), await head(dir, 'origin/feature'));
});

test('catchUpWith leaves unpushed local commits alone', async () => {
  const { dir } = await pushedFeature();
  await commitFile(dir, 'local.txt', 'local\n', 'feat: not pushed yet');
  const local = await head(dir);

  assert.equal(await catchUpWith(dir, 'origin/feature'), 'ahead');
  assert.equal(await head(dir), local);
});

test('catchUpWith follows a remote rewrite of a head the factory had pushed', async () => {
  const { dir, github } = await pushedFeature();
  await rewriteOnGithub(github, dir);

  assert.equal(await catchUpWith(dir, 'origin/feature'), 'followed-rewrite');
  assert.equal(await head(dir), await head(dir, 'origin/feature'));
  assert.equal(fs.readFileSync(path.join(dir, 'feature.txt'), 'utf8'), 'feature, rebased\n');
});

test('catchUpWith does not throw away local work when the remote was rewritten', async () => {
  const { dir, github } = await pushedFeature();
  await commitFile(dir, 'local.txt', 'local\n', 'feat: not pushed yet');
  const local = await head(dir);
  await rewriteOnGithub(github, dir);

  assert.equal(await catchUpWith(dir, 'origin/feature'), 'diverged');
  assert.equal(await head(dir), local);
});

test('sees no change when nothing moved', async () => {
  const { dir } = await repoWithBase();
  const before = await worktreeState(dir);

  assert.deepEqual(worktreeChanges(before, await worktreeState(dir)), []);
});

test('reports a moved HEAD', async () => {
  const { dir } = await repoWithBase();
  const before = await worktreeState(dir);
  await commitFile(dir, 'feature.txt', 'feature\n', 'feat: add the feature');

  const changes = worktreeChanges(before, await worktreeState(dir));
  assert.equal(changes.length, 1);
  assert.match(changes[0], /^HEAD moved from /);
});

test('reports a modified tracked file', async () => {
  const { dir } = await repoWithBase();
  const before = await worktreeState(dir);
  fs.writeFileSync(path.join(dir, 'base.txt'), 'changed\n');

  assert.deepEqual(worktreeChanges(before, await worktreeState(dir)), ['tracked files or the index changed']);
});

test('reports a staged change', async () => {
  const { dir } = await repoWithBase();
  const before = await worktreeState(dir);
  fs.writeFileSync(path.join(dir, 'base.txt'), 'changed\n');
  await run(dir, 'add', 'base.txt');

  assert.deepEqual(worktreeChanges(before, await worktreeState(dir)), ['tracked files or the index changed']);
});

test('ignores an untracked scratch file', async () => {
  const { dir } = await repoWithBase();
  const before = await worktreeState(dir);
  fs.writeFileSync(path.join(dir, 'scratch.txt'), 'notes\n');

  assert.deepEqual(worktreeChanges(before, await worktreeState(dir)), []);
});

test('countsTowardSize leaves out tests and lockfiles', () => {
  for (const file of ['src/a.ts', 'service/billing/charges.py', 'web/src/latest.tsx', 'docs/testing.md']) assert.equal(countsTowardSize(file), true, file);
  for (const file of [
    'src/a.test.ts',
    'src/a.spec.tsx',
    'src/__tests__/a.ts',
    'service/billing/tests/test_charges.py',
    'test_utils.py',
    'pkg/charges_test.go',
    'web/src/__snapshots__/a.snap',
    'pnpm-lock.yaml',
    'web/package-lock.json',
    'uv.lock',
  ]) {
    assert.equal(countsTowardSize(file), false, file);
  }
});

test('linesInNumstat adds both columns of the files that count and skips binaries and generated files', () => {
  const numstat = ['10\t2\tsrc/a.ts', '30\t0\tsrc/a.test.ts', '-\t-\tlogo.png', '400\t100\tidl/billing/openapi.json', '1\t1\tpnpm-lock.yaml', ''].join('\n');
  assert.equal(linesInNumstat(numstat, new Set(['idl/billing/openapi.json'])), 12);
  assert.equal(linesInNumstat('', new Set()), 0);
});

test('diffLines leaves out files the repo marks linguist-generated', async () => {
  const { dir, base } = await repoWithBase();
  fs.mkdirSync(path.join(dir, 'idl'));
  await commitFile(dir, '.gitattributes', 'idl/*.json linguist-generated=true\n', 'chore: mark generated files');
  await commitFile(dir, 'idl/openapi.json', '{\n}\n', 'chore: regenerate');
  await commitFile(dir, 'feature.ts', 'export const a = 1;\n', 'feat: add the feature');

  assert.equal(await diffLines(dir, base), 2);
});

const siblingOf = (dir: string, name: string) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'factory-wt-')), name);

test('ensureWorktree creates the branch from the base and checks its files out', async () => {
  const { dir, base } = await repoWithBase();
  const wt = siblingOf(dir, 'ticket');

  assert.equal(await ensureWorktree(dir, wt, 'factory/ticket', 'main'), true);

  assert.equal(fs.readFileSync(path.join(wt, 'base.txt'), 'utf8'), 'base\n');
  assert.equal(await head(wt), base);
  assert.equal(await run(wt, 'branch', '--show-current'), 'factory/ticket');
  assert.equal(await run(wt, 'status', '--porcelain'), '');
  assert.equal(await ensureWorktree(dir, wt, 'factory/ticket', 'main'), false);
});

test('ensureWorktree finishes a worktree that was created but never checked out', async () => {
  const { dir } = await repoWithBase();
  const wt = siblingOf(dir, 'ticket');
  await run(dir, 'worktree', 'add', '--quiet', '--no-checkout', '-b', 'factory/ticket', wt, 'main');
  assert.equal(fs.existsSync(path.join(wt, 'base.txt')), false);

  assert.equal(await ensureWorktree(dir, wt, 'factory/ticket', 'main'), true);

  assert.equal(fs.readFileSync(path.join(wt, 'base.txt'), 'utf8'), 'base\n');
  assert.equal(await run(wt, 'status', '--porcelain'), '');
});

test('ensureWorktree refuses a worktree that is on another branch', async () => {
  const { dir } = await repoWithBase();
  const wt = siblingOf(dir, 'ticket');
  await ensureWorktree(dir, wt, 'factory/ticket', 'main');
  await assert.rejects(ensureWorktree(dir, wt, 'factory/other', 'main'), /is on factory\/ticket, expected factory\/other/);
});

test("ensureWorktree runs the repo's post-checkout hook like git worktree add does", async () => {
  const { dir, base } = await repoWithBase();
  const hook = path.join(dir, '.git', 'hooks', 'post-checkout');
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, '#!/bin/sh\necho "$1 $2 $3" > hook-ran.txt\n', { mode: 0o755 });
  const wt = siblingOf(dir, 'ticket');

  await ensureWorktree(dir, wt, 'factory/ticket', 'main');

  assert.equal(fs.readFileSync(path.join(wt, 'hook-ran.txt'), 'utf8').trim(), `${'0'.repeat(40)} ${base} 1`);
});

test('ensureWorktree checks files out as heavy work, after it let go of the repo', async () => {
  const { dir } = await repoWithBase();
  const wt = siblingOf(dir, 'ticket');
  let repoWasFree = false;
  let heavyRuns = 0;

  await ensureWorktree(dir, wt, 'factory/ticket', 'main', async (work) => {
    heavyRuns++;
    assert.equal(fs.existsSync(path.join(wt, 'base.txt')), false);
    repoWasFree = await Promise.race([withRepoLock(dir, async () => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000))]);
    return work();
  });

  assert.equal(heavyRuns, 1);
  assert.equal(repoWasFree, true);
  assert.equal(fs.existsSync(path.join(wt, 'base.txt')), true);
});

test('creates many worktrees of one repo at the same time', async () => {
  const { dir } = await repoWithBase();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-wt-'));
  const names = Array.from({ length: 12 }, (_, i) => `ticket-${i}`);

  await Promise.all(names.map((n) => ensureWorktree(dir, path.join(root, n), `factory/${n}`, 'main')));

  for (const n of names) {
    assert.equal(fs.readFileSync(path.join(root, n, 'base.txt'), 'utf8'), 'base\n');
    assert.equal(await run(path.join(root, n), 'branch', '--show-current'), `factory/${n}`);
  }
});

test('waitForEarlierCheckout waits for a checkout of that worktree that is still running, and for no other', async () => {
  const { dir } = await repoWithBase();
  await run(dir, 'config', 'filter.slow.smudge', 'sleep 1; cat');
  await commitFile(dir, '.gitattributes', 'base.txt filter=slow\n', 'chore: make the checkout slow');
  const wt = siblingOf(dir, 'ticket');
  const checkout = ensureWorktree(dir, wt, 'factory/ticket', 'main');
  while (!fs.existsSync(path.join(wt, '.git'))) await new Promise((resolve) => setTimeout(resolve, 20));
  await new Promise((resolve) => setTimeout(resolve, 300));

  assert.equal(await waitForEarlierCheckout(`${wt}-other`, 20), false);
  assert.equal(await waitForEarlierCheckout(wt, 20), true);

  assert.equal(fs.readFileSync(path.join(wt, 'base.txt'), 'utf8'), 'base\n');
  assert.equal(await waitForEarlierCheckout(wt, 20), false);
  await checkout;
});

test('untouchedWorktreeBranch names the branch of a worktree that is still at its base, checked out or not', async () => {
  const { dir } = await repoWithBase();
  const wt = siblingOf(dir, 'ticket');
  assert.equal(await untouchedWorktreeBranch(dir, wt, 'main'), null);
  await run(dir, 'worktree', 'add', '--quiet', '--no-checkout', '-b', 'factory/ticket', wt, 'main');

  assert.equal(await untouchedWorktreeBranch(dir, wt, 'main'), 'factory/ticket');
  await checkOutAgain(wt);
  assert.equal(await untouchedWorktreeBranch(dir, wt, 'main'), 'factory/ticket');
});

test('untouchedWorktreeBranch gives up a worktree that has commits, an older base or a lock a killed checkout left', async () => {
  const { dir } = await repoWithBase();
  const [committed, behind, locked] = ['committed', 'behind', 'locked'].map((n) => siblingOf(dir, n));
  await ensureWorktree(dir, committed, 'factory/committed', 'main');
  await ensureWorktree(dir, behind, 'factory/behind', 'main');
  await ensureWorktree(dir, locked, 'factory/locked', 'main');

  await commitFile(committed, 'feature.txt', 'work\n', 'feat: agent work');
  fs.writeFileSync(path.resolve(locked, await run(locked, 'rev-parse', '--git-path', 'index.lock')), '');
  assert.equal(await untouchedWorktreeBranch(dir, committed, 'main'), null);
  assert.equal(await untouchedWorktreeBranch(dir, locked, 'main'), null);
  assert.equal(await untouchedWorktreeBranch(dir, behind, 'main'), 'factory/behind');
  await commitFile(dir, 'newer.txt', 'newer\n', 'feat: the base moved on');
  assert.equal(await untouchedWorktreeBranch(dir, behind, 'main'), null);
});

test('checkOutAgain finishes a worktree and runs the post-checkout hook even when the files are already there', async () => {
  const { dir } = await repoWithBase();
  const hook = path.join(dir, '.git', 'hooks', 'post-checkout');
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, '#!/bin/sh\necho ran >> hook-runs.txt\n', { mode: 0o755 });
  const wt = siblingOf(dir, 'ticket');
  await run(dir, 'worktree', 'add', '--quiet', '--no-checkout', '-b', 'factory/ticket', wt, 'main');

  await checkOutAgain(wt);
  await checkOutAgain(wt);

  assert.equal(fs.readFileSync(path.join(wt, 'base.txt'), 'utf8'), 'base\n');
  assert.equal(fs.readFileSync(path.join(wt, 'hook-runs.txt'), 'utf8'), 'ran\nran\n');
});

test('fetchOrigin shares one fetch between callers that ask while it still waits for the repo', async () => {
  const { dir } = await pushedFeature();
  let release!: () => void;
  const repoBusy = withRepoLock(dir, () => new Promise<void>((resolve) => (release = resolve)));

  const first = fetchOrigin(dir, { refs: ['main'] });
  const second = fetchOrigin(dir, { refs: ['main'] });
  const otherRefs = fetchOrigin(dir, { refs: ['feature'] });
  assert.equal(second, first);
  assert.notEqual(otherRefs, first);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await repoBusy;

  assert.equal((await first).code, 0);
  assert.equal((await otherRefs).code, 0);
  assert.notEqual(fetchOrigin(dir, { refs: ['main'] }), first);
});

test('carryTreeOnto lands a rebuild on the PR branch it replaces as a fast-forward, keeping both histories', async () => {
  const { dir } = await repoWithBase();
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-carry-remote-'));
  await run(remote, 'init', '--quiet', '--bare');
  await run(dir, 'remote', 'add', 'origin', remote);
  await run(dir, 'push', '--quiet', 'origin', 'main');
  await run(dir, 'checkout', '--quiet', '-b', 'factory/i/04-videos');
  await commitFile(dir, 'videos.py', 'old = "summaries"\n', 'feat: the first build');
  await run(dir, 'push', '--quiet', 'origin', 'factory/i/04-videos');
  const earlier = await run(dir, 'rev-parse', 'HEAD');

  await run(dir, 'checkout', '--quiet', 'main');
  await run(dir, 'branch', '--quiet', '-D', 'factory/i/04-videos');
  await run(dir, 'checkout', '--quiet', '-b', 'factory/i/04-videos', 'main');
  await commitFile(dir, 'videos.py', 'new = "get_assets_by_id"\n', 'feat: the rebuild');
  const rebuilt = await run(dir, 'rev-parse', 'HEAD');
  assert.notEqual((await git(dir, ['push', 'origin', 'factory/i/04-videos'])).code, 0, 'a plain push of the rebuild is rejected');

  await run(dir, 'fetch', '--quiet', 'origin');
  const carried = await carryTreeOnto(dir, 'origin/factory/i/04-videos', 'Rebuild the videos ticket');
  assert.ok(carried);
  assert.equal(await run(dir, 'rev-parse', 'HEAD'), carried);
  assert.equal((await run(dir, 'rev-list', '--parents', '-n', '1', 'HEAD')).split(' ').slice(1).join(' '), `${rebuilt} ${earlier}`);
  assert.equal(await run(dir, 'rev-parse', 'HEAD^{tree}'), await run(dir, 'rev-parse', `${rebuilt}^{tree}`), 'the tree is the rebuild’s');
  assert.equal((await git(dir, ['push', 'origin', 'factory/i/04-videos'])).code, 0, 'the push is a fast-forward');
  assert.equal(await run(dir, 'diff', 'main...HEAD', '--', 'videos.py').then((d) => d.includes('+new = "get_assets_by_id"')), true);
  assert.equal(await carryTreeOnto(dir, 'origin/factory/i/04-videos', 'again'), null, 'nothing to carry once the remote head is in HEAD’s history');
});
