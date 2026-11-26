import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fetchOrigin, findCommitsMissingFromHead, isAncestor, mergeInto, push, revParse, trackingRefspec } from '../git.ts';
import { stackBase, syncTarget } from './stacks.ts';

const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

function commitFile(cwd: string, file: string, text: string, message: string): void {
  fs.writeFileSync(path.join(cwd, file), text);
  run(cwd, 'add', file);
  run(cwd, 'commit', '-q', '-m', message);
}

// A GitHub stand-in: a bare origin with master, PR 01 on its own branch and PR 02 stacked on it, and the
// factory's worktree of 02.
function stackedRepos() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-landed-'));
  const origin = path.join(tmp, 'origin.git');
  const seed = path.join(tmp, 'seed');
  run(tmp, 'init', '-q', '--bare', '-b', 'master', origin);
  run(tmp, 'clone', '-q', origin, seed);
  commitFile(seed, 'app.py', 'base\n', 'base');
  run(seed, 'push', '-q', 'origin', 'HEAD:master');
  run(seed, 'checkout', '-q', '-b', 'factory/x/01');
  commitFile(seed, 'one.py', 'one\n', 'ticket 01');
  run(seed, 'push', '-q', 'origin', 'factory/x/01');
  run(seed, 'checkout', '-q', '-b', 'factory/x/02');
  commitFile(seed, 'two.py', 'two\n', 'ticket 02');
  run(seed, 'push', '-q', 'origin', 'factory/x/02');
  const worktree = path.join(tmp, 'wt-02');
  run(tmp, 'clone', '-q', '-b', 'factory/x/02', origin, worktree);
  return { tmp, origin, seed, worktree };
}

// The owner merges PR 01 on GitHub with a merge commit, and a commit from someone else lands on master too.
function mergePr01(seed: string): string {
  run(seed, 'checkout', '-q', 'master');
  run(seed, 'pull', '-q', 'origin', 'master');
  commitFile(seed, 'other.py', 'other\n', 'someone else');
  run(seed, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #1', 'origin/factory/x/01');
  run(seed, 'push', '-q', 'origin', 'master');
  return run(seed, 'rev-parse', 'HEAD');
}

test('after the owner merges the PR below, the stacked PR moves onto master, merges it in and pushes, and only then has the landed commit', async () => {
  const { tmp, seed, worktree } = stackedRepos();
  try {
    const one = { key: '01', status: 'approved' as const, dependsOn: [] as string[], prNumber: 1, prState: 'OPEN', branch: 'factory/x/01', prHeadRef: null, baseRef: 'master' };
    const two = { key: '02', status: 'approved' as const, dependsOn: ['01'], prNumber: 2, prState: 'OPEN', branch: 'factory/x/02', prHeadRef: null, baseRef: 'factory/x/01' };
    const merged = mergePr01(seed);
    const all = [{ ...one, status: 'merged' as const, prState: 'MERGED' }, two];

    assert.equal(stackBase(two, all), null);
    assert.deepEqual(syncTarget(two, all, 'master'), { parent: null, target: 'master' });

    assert.equal((await fetchOrigin(worktree, { refs: [trackingRefspec('master')] })).code, 0);
    assert.deepEqual(await findCommitsMissingFromHead(worktree, [merged, 'f'.repeat(40)]), [merged]);

    const before = await revParse(worktree, 'HEAD');
    assert.equal((await mergeInto(worktree, 'origin/master')).ok, true);
    assert.equal((await push(worktree, 'factory/x/02')).code, 0);

    assert.deepEqual(await findCommitsMissingFromHead(worktree, [merged]), []);
    assert.ok(await isAncestor(worktree, before!, 'HEAD'), 'the merge keeps the PR history: no rebase, no force-push');
    run(seed, 'fetch', '-q', 'origin');
    assert.equal(run(seed, 'rev-parse', 'origin/factory/x/02'), run(worktree, 'rev-parse', 'HEAD'), 'the merge is pushed to the PR branch');
    assert.deepEqual(run(worktree, 'diff', '--name-only', 'origin/master...HEAD').split('\n'), ['two.py'], 'the PR now shows only its own change');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a stacked PR that conflicts with the merged master is left as it was for a fixer', async () => {
  const { tmp, seed, worktree } = stackedRepos();
  try {
    run(seed, 'checkout', '-q', 'master');
    commitFile(seed, 'two.py', 'master changed this too\n', 'conflicting change');
    run(seed, 'push', '-q', 'origin', 'master');
    assert.equal((await fetchOrigin(worktree, { refs: [trackingRefspec('master')] })).code, 0);
    const before = await revParse(worktree, 'HEAD');
    const merged = await mergeInto(worktree, 'origin/master');
    assert.equal(merged.ok, false);
    assert.match(merged.output, /CONFLICT/);
    assert.equal(await revParse(worktree, 'HEAD'), before);
    assert.equal(run(worktree, 'status', '--porcelain'), '', 'the aborted merge leaves a clean worktree');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
