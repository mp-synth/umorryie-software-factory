import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { git, restoreHistoryFrom } from './git.ts';

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
