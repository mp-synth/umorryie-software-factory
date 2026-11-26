import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { git } from '../git.ts';
import { baseCheckout } from './base-checkout.ts';

async function run(cwd: string, ...args: string[]): Promise<string> {
  const r = await git(cwd, args);
  assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

async function commitFile(dir: string, file: string, content: string, message: string): Promise<string> {
  fs.writeFileSync(path.join(dir, file), content);
  await run(dir, 'add', file);
  await run(dir, 'commit', '--quiet', '-m', message);
  return run(dir, 'rev-parse', 'HEAD');
}

/** A main checkout whose local master is one commit behind origin, with an uncommitted edit and a gitignored .env. */
async function staleMainCheckout(): Promise<{ main: string; upstream: string; root: string }> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-base-'));
  const remote = path.join(tmp, 'remote.git');
  const upstream = path.join(tmp, 'upstream');
  const main = path.join(tmp, 'main');
  fs.mkdirSync(upstream);
  await run(tmp, 'init', '--quiet', '--bare', remote);
  await run(upstream, 'init', '--quiet', '--initial-branch=master');
  await run(upstream, 'config', 'user.email', 'factory@example.com');
  await run(upstream, 'config', 'user.name', 'Factory');
  fs.writeFileSync(path.join(upstream, '.gitignore'), '.env\n');
  await run(upstream, 'add', '.gitignore');
  await commitFile(upstream, 'api.py', 'def old(): ...\n', 'first');
  await run(upstream, 'remote', 'add', 'origin', remote);
  await run(upstream, 'push', '--quiet', 'origin', 'master');
  await run(tmp, 'clone', '--quiet', remote, main);
  fs.writeFileSync(path.join(main, '.env'), 'KEY=dev\n');
  fs.writeFileSync(path.join(main, 'api.py'), 'def local_edit(): ...\n');
  await commitFile(upstream, 'api.py', 'def group_by(): ...\n', 'second');
  await run(upstream, 'push', '--quiet', 'origin', 'master');
  return { main, upstream, root: path.join(tmp, 'factory', '_base') };
}

test('baseCheckout reads origin, not a main checkout that is behind or edited', async () => {
  const { main, upstream, root } = await staleMainCheckout();
  const originSha = await run(upstream, 'rev-parse', 'HEAD');
  assert.notEqual(await run(main, 'rev-parse', 'master'), originSha, 'the local branch starts behind origin');

  const base = await baseCheckout(main, root, 'master', { copyFiles: ['.env'] });

  assert.equal(base.ref, 'origin/master');
  assert.equal(base.sha, originSha);
  assert.equal(await run(base.dir, 'rev-parse', 'HEAD'), originSha);
  assert.equal(fs.readFileSync(path.join(base.dir, 'api.py'), 'utf8'), 'def group_by(): ...\n');
  assert.equal(fs.readFileSync(path.join(base.dir, '.env'), 'utf8'), 'KEY=dev\n', 'gitignored local files are copied as into ticket worktrees');
  assert.equal(fs.readFileSync(path.join(main, 'api.py'), 'utf8'), 'def local_edit(): ...\n', 'the main checkout is left alone');
  assert.equal(await run(main, 'branch', '--show-current'), 'master');
});

test('baseCheckout refreshes caller-specific local files when reusing a checkout', async () => {
  const { main, root } = await staleMainCheckout();
  fs.writeFileSync(path.join(main, '.worktreeinclude'), '.local-tool\n');
  fs.writeFileSync(path.join(main, '.local-tool'), 'first\n');

  const first = await baseCheckout(main, root, 'master');
  assert.equal(fs.readFileSync(path.join(first.dir, '.local-tool'), 'utf8'), 'first\n');
  assert.equal(fs.existsSync(path.join(first.dir, '.env')), false);

  fs.writeFileSync(path.join(main, '.local-tool'), 'second\n');
  const reused = await baseCheckout(main, root, 'master', { copyFiles: ['.env'] });

  assert.equal(reused.dir, first.dir);
  assert.equal(fs.readFileSync(path.join(reused.dir, '.local-tool'), 'utf8'), 'second\n');
  assert.equal(fs.readFileSync(path.join(reused.dir, '.env'), 'utf8'), 'KEY=dev\n');
});

async function pushCommit(upstream: string, content: string, message: string): Promise<string> {
  const sha = await commitFile(upstream, 'api.py', content, message);
  await run(upstream, 'push', '--quiet', 'origin', 'master');
  return sha;
}

test('baseCheckout moves the one checkout of a branch to the new commit when nothing reads it', async () => {
  const { main, upstream, root } = await staleMainCheckout();
  const [first, again] = await Promise.all([baseCheckout(main, root, 'master', { copyFiles: ['.env'] }), baseCheckout(main, root, 'master')]);
  assert.equal(first.dir, again.dir, 'concurrent steps on the same commit share one checkout');

  const sha = await pushCommit(upstream, 'def entity(): ...\n', 'third');
  const moved = await baseCheckout(main, root, 'master', { keepMs: 0, inUse: async () => [] });
  assert.equal(moved.dir, first.dir);
  assert.equal(await run(moved.dir, 'rev-parse', 'HEAD'), sha);
  assert.equal(fs.readFileSync(path.join(moved.dir, 'api.py'), 'utf8'), 'def entity(): ...\n');
  assert.equal(fs.readFileSync(path.join(moved.dir, '.env'), 'utf8'), 'KEY=dev\n', 'gitignored copies survive the move');
  assert.deepEqual(fs.readdirSync(root), [path.basename(first.dir)]);
});

test('baseCheckout cuts a second checkout only while the first is read, and removes it once idle', async () => {
  const { main, upstream, root } = await staleMainCheckout();
  const first = await baseCheckout(main, root, 'master');
  const firstSha = first.sha;

  await pushCommit(upstream, 'def entity(): ...\n', 'third');
  const justHandedOut = await baseCheckout(main, root, 'master', { inUse: async () => [] });
  assert.notEqual(justHandedOut.dir, first.dir, 'a checkout handed out moments ago may not have its agent running yet');

  const sha = await pushCommit(upstream, 'def video(): ...\n', 'fourth');
  const read = await baseCheckout(main, root, 'master', { keepMs: 0, inUse: async () => [path.join(first.dir, 'service')] });
  assert.notEqual(read.dir, first.dir);
  assert.equal(await run(first.dir, 'rev-parse', 'HEAD'), firstSha, 'a checkout an agent runs in is left where it is');
  assert.equal(await run(read.dir, 'rev-parse', 'HEAD'), sha);
  assert.equal(read.dir, justHandedOut.dir, 'the idle second checkout is moved, not a third one cut');

  const latest = await baseCheckout(main, root, 'master', { keepMs: 0, inUse: async () => [] });
  assert.equal(latest.dir, read.dir);
  assert.deepEqual(fs.readdirSync(root), [path.basename(latest.dir)], 'the first is removed once nothing reads it');
  const worktrees = await run(main, 'worktree', 'list', '--porcelain');
  assert.ok(!worktrees.includes(first.dir), 'git forgets removed checkouts');
});

test('baseCheckout keeps the checkouts of a branch whose name extends another', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-base-prefix-'));
  await run(dir, 'init', '--quiet', '--initial-branch=main');
  await run(dir, 'config', 'user.email', 'factory@example.com');
  await run(dir, 'config', 'user.name', 'Factory');
  await commitFile(dir, 'a.txt', 'a\n', 'first');
  await run(dir, 'branch', 'main-v2');
  const root = path.join(dir, '..', path.basename(dir) + '-base');

  const v2 = await baseCheckout(dir, root, 'main-v2', { keepMs: 0, inUse: async () => [] });
  await commitFile(dir, 'a.txt', 'b\n', 'second');
  await baseCheckout(dir, root, 'main', { keepMs: 0, inUse: async () => [] });
  await commitFile(dir, 'a.txt', 'c\n', 'third');
  await baseCheckout(dir, root, 'main', { keepMs: 0, inUse: async () => [] });
  assert.ok(fs.existsSync(v2.dir), 'cleaning up main leaves main-v2 alone');
  assert.equal(fs.readdirSync(root).length, 2);
});

test('baseCheckout uses the local branch when the repo has no origin', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-base-local-'));
  await run(dir, 'init', '--quiet', '--initial-branch=main');
  await run(dir, 'config', 'user.email', 'factory@example.com');
  await run(dir, 'config', 'user.name', 'Factory');
  const sha = await commitFile(dir, 'a.txt', 'a\n', 'first');
  await run(dir, 'checkout', '--quiet', '-b', 'feature');
  await commitFile(dir, 'a.txt', 'feature\n', 'on a feature branch');

  const base = await baseCheckout(dir, path.join(dir, '..', path.basename(dir) + '-base'), 'main');

  assert.equal(base.ref, 'main');
  assert.equal(base.sha, sha);
  assert.equal(fs.readFileSync(path.join(base.dir, 'a.txt'), 'utf8'), 'a\n', 'reads the base branch even when the main checkout is on another branch');
});
