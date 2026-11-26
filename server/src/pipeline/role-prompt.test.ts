import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ROLE_FILES, readAgentFile, rolePrompt, rolePromptSha, type AgentKind } from './role-prompt.ts';

const kinds = Object.keys(ROLE_FILES) as AgentKind[];
const codeStyleKinds: AgentKind[] = ['execute', 'fix', 'review', 'verify', 'arbitrate', 'plan', 'plan_review', 'steer'];
const kindsWritingForPeople: AgentKind[] = ['execute', 'fix', 'review', 'arbitrate'];

test('every kind includes its role file and the repo rules', () => {
  for (const kind of kinds) {
    const prompt = rolePrompt(kind);
    assert.ok(prompt.includes(readAgentFile(ROLE_FILES[kind])), kind);
    assert.ok(prompt.includes(readAgentFile('repo-rules.md')), kind);
  }
});

test('code style is included for exactly the kinds that write, judge or plan code', () => {
  const style = readAgentFile('code-style.md');
  for (const kind of kinds) assert.equal(rolePrompt(kind).includes(style), codeStyleKinds.includes(kind), kind);
});

test('the writing rules are included for exactly the kinds whose text reaches people', () => {
  const writing = readAgentFile('writing.md');
  for (const kind of kinds) assert.equal(rolePrompt(kind).includes(writing), kindsWritingForPeople.includes(kind), kind);
});

test('the prompt hash is stable per kind and differs between kinds', () => {
  const shas = kinds.map((k) => rolePromptSha(rolePrompt(k)));
  assert.deepEqual(shas, kinds.map((k) => rolePromptSha(rolePrompt(k))));
  assert.equal(new Set(shas).size, kinds.length);
  assert.match(shas[0], /^[0-9a-f]{64}$/);
});

test('an absolute role file is honoured', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'role-prompt-'));
  const file = path.join(dir, 'variant.md');
  fs.writeFileSync(file, 'variant role text\n');
  try {
    const prompt = rolePrompt('review', file);
    assert.ok(prompt.startsWith('variant role text'));
    assert.ok(prompt.includes(readAgentFile('repo-rules.md')));
    assert.ok(!prompt.includes(readAgentFile(ROLE_FILES.review)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('project rules reach exactly the agents their role names', () => {
  const rules = [
    { role: 'code' as const, body: 'Use the shared client.' },
    { role: 'planner' as const, body: 'Plan migrations as their own ticket.' },
  ];
  assert.ok(rolePrompt('execute', undefined, rules).includes('- Use the shared client.'));
  assert.ok(rolePrompt('review', undefined, rules).includes('- Use the shared client.'));
  assert.ok(!rolePrompt('execute', undefined, rules).includes('Plan migrations'));
  assert.ok(rolePrompt('plan', undefined, rules).includes('- Plan migrations as their own ticket.'));
  assert.ok(!rolePrompt('plan', undefined, rules).includes('shared client'));
  assert.equal(rolePrompt('ask', undefined, rules), rolePrompt('ask'));
  assert.ok(rolePrompt('ask', undefined, [{ role: 'all', body: 'Everyone.' }]).includes('- Everyone.'));
});
