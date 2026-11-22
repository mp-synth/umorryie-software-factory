import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { countsTowardSize, diffLines, git, linesInNumstat, restoreHistoryFrom, worktreeChanges, worktreeState } from './git.ts';

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
