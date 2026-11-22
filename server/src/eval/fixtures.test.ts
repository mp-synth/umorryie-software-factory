import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import * as gitx from '../git.ts';
import { CASES, buildFixture, removeFixture } from './fixtures.ts';

const lines = (text: string) => text.split('\n').filter(Boolean);

const changedFiles = async (cwd: string, range: string) => lines((await gitx.git(cwd, ['diff', '--name-only', range])).stdout);

test('case names are unique and each role has exactly one clean control', () => {
  assert.equal(new Set(CASES.map((c) => c.name)).size, CASES.length);
  for (const role of ['review', 'verify']) {
    const ofRole = CASES.filter((c) => c.role === role);
    assert.equal(ofRole.filter((c) => !c.defectKind).length, 1);
    assert.ok(ofRole.filter((c) => c.defectKind).length >= 4);
  }
});

test('expected verdicts match the role and the defect declaration', () => {
  for (const c of CASES) {
    assert.equal(!c.defectKind, c.expected === 'APPROVE');
    assert.equal(!c.defectKind, !c.defectFile);
    if (c.defectKind) assert.equal(c.expected, c.role === 'review' ? 'CHANGES' : 'BLOCK');
  }
});

for (const c of CASES) {
  test(`fixture ${c.name} has its branch, differs from the base and holds the defect file`, async () => {
    const f = await buildFixture(c.name);
    try {
      assert.ok((await gitx.git(f.worktree, ['branch', '--list', f.branch])).stdout.includes(f.branch));
      const changed = await changedFiles(f.worktree, `${f.base}...${f.branch}`);
      assert.ok(changed.length > 0);
      if (c.defectFile) assert.ok(changed.includes(c.defectFile), `${c.defectFile} not in ${changed.join(', ')}`);
      for (const input of f.inputs) assert.ok(fs.existsSync(input), input);
      assert.equal(fs.existsSync(f.output), false);
      assert.ok(path.resolve(f.output).startsWith(path.resolve(f.dir)));
      assert.equal(f.start !== null, c.role === 'verify');
      if (f.start) assert.ok((await changedFiles(f.worktree, `${f.start}..HEAD`)).length > 0);
    } finally {
      removeFixture(f);
    }
  });
}

test('every fixture writes the checks log that checks.md names', async () => {
  for (const name of ['review-clean-bulk-pricing', 'verify-clean-fix']) {
    const f = await buildFixture(name);
    try {
      const log = path.join(f.runDir, 'checks.log');
      assert.equal(fs.readFileSync(log, 'utf8').trim(), 'no syntax errors');
      assert.ok(fs.readFileSync(path.join(f.runDir, 'checks.md'), 'utf8').includes(`Full output: ${log}.`));
    } finally {
      removeFixture(f);
    }
  }
});

test('the pull request changes of a review fixture name no function, constant or path', async () => {
  for (const c of CASES.filter((x) => x.role === 'review')) {
    const f = await buildFixture(c.name);
    try {
      const build = fs.readFileSync(f.inputs[1], 'utf8');
      const what = build.slice(build.indexOf('### What'));
      assert.doesNotMatch(what, /[a-z][A-Z]|[A-Z]{2}_|\.js\b/, c.name);
    } finally {
      removeFixture(f);
    }
  }
});

test('a verify fixture names the real fix commit in fix.md', async () => {
  const f = await buildFixture('verify-clean-fix');
  try {
    const fix = fs.readFileSync(f.inputs[0], 'utf8');
    const sha = (await gitx.git(f.worktree, ['rev-parse', '--short', 'HEAD'])).stdout.trim();
    assert.ok(fix.includes(sha));
    assert.ok(!fix.includes('{{fix'));
  } finally {
    removeFixture(f);
  }
});

test('the false rebuttal cites a line that does not validate anything', async () => {
  const f = await buildFixture('verify-false-rebuttal');
  try {
    const cited = fs.readFileSync(path.join(f.worktree, 'src/pricing.js'), 'utf8').split('\n')[1];
    assert.ok(fs.readFileSync(f.inputs[0], 'utf8').includes('src/pricing.js:2 already validates'));
    assert.ok(!/RangeError|isInteger|throw/.test(cited));
  } finally {
    removeFixture(f);
  }
});

test('removing a fixture deletes its directory', async () => {
  const f = await buildFixture('review-clean-bulk-pricing');
  removeFixture(f);
  assert.equal(fs.existsSync(f.dir), false);
});

test('an unknown case is rejected', async () => {
  await assert.rejects(() => buildFixture('nope'), /no eval case named nope/);
});
