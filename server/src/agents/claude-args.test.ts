import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DISALLOWED_TOOLS, TOOLS } from '../pipeline/role-prompt.ts';
import { buildArgs, type AgentSpec } from './claude.ts';

function specFor(kind: 'execute' | 'review'): AgentSpec {
  return {
    cwd: '/tmp/work',
    model: 'opus',
    rolePrompt: 'role',
    prompt: 'do the thing',
    tools: TOOLS[kind],
    disallowedTools: DISALLOWED_TOOLS[kind],
    addDirs: ['/tmp/extra'],
    timeoutMs: 1000,
    loadUserSettings: false,
  };
}

function denied(args: string[]): string[] {
  const start = args.indexOf('--disallowed-tools') + 1;
  const end = args.findIndex((a, i) => i >= start && a.startsWith('--'));
  return args.slice(start, end);
}

test('denies pushing and talking to GitHub for a write kind', () => {
  const list = denied(buildArgs(specFor('execute')));
  assert.ok(list.includes('Bash(git push:*)'));
  assert.ok(list.includes('Bash(gh pr merge:*)'));
  assert.ok(!list.includes('Bash(git commit:*)'));
  assert.ok(!list.some((p) => p.startsWith('Bash(gh pr view')));
});

test('also denies commits and history rewrites for a read-only kind', () => {
  const list = denied(buildArgs(specFor('review')));
  for (const p of ['Bash(git push:*)', 'Bash(git commit:*)', 'Bash(git reset:*)', 'Bash(git rebase:*)']) assert.ok(list.includes(p), p);
});

test('keeps the prompt as the first positional argument and the deny list flag-delimited', () => {
  const args = buildArgs(specFor('review'));
  assert.deepEqual(args.slice(0, 2), ['-p', 'do the thing']);
  assert.ok(args[args.indexOf('--disallowed-tools') + DISALLOWED_TOOLS.review.length + 1].startsWith('--'));
});

test('omits the flag when nothing is denied', () => {
  assert.ok(!buildArgs({ ...specFor('review'), disallowedTools: undefined }).includes('--disallowed-tools'));
});
