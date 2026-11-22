import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ROLE_FILES, readAgentFile, rolePrompt, rolePromptSha, type AgentKind } from './role-prompt.ts';

const kinds = Object.keys(ROLE_FILES) as AgentKind[];
const codeKinds: AgentKind[] = ['execute', 'fix', 'review', 'verify'];

test('every kind includes its role file and the repo rules', () => {
  for (const kind of kinds) {
    const prompt = rolePrompt(kind);
    assert.ok(prompt.includes(readAgentFile(ROLE_FILES[kind])), kind);
    assert.ok(prompt.includes(readAgentFile('repo-rules.md')), kind);
  }
});

test('code style is included for exactly the kinds that write or judge code', () => {
  const style = readAgentFile('code-style.md');
  for (const kind of kinds) assert.equal(rolePrompt(kind).includes(style), codeKinds.includes(kind), kind);
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
