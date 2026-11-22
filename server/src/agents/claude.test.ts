import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { AgentEvent, AgentSpec } from './claude.ts';

process.env.CLAUDE_BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.mjs');

const { startAgent } = await import('./claude.ts');

const spec = (scenario: string, timeoutMs = 10_000): AgentSpec => ({
  cwd: process.cwd(),
  model: 'fake-model',
  rolePrompt: 'role',
  prompt: 'do it',
  tools: ['Read'],
  addDirs: [],
  timeoutMs,
  loadUserSettings: false,
  env: { FAKE_SCENARIO: scenario },
});

async function run(scenario: string, timeoutMs?: number) {
  const events: AgentEvent[] = [];
  const handle = startAgent(spec(scenario, timeoutMs), (e) => events.push(e));
  const result = await handle.done;
  return { events, result };
}

const types = (events: AgentEvent[]) => events.map((e) => e.type);

test('maps a successful run to events and result fields', async () => {
  const { events, result } = await run('success');
  assert.deepEqual(types(events), ['init', 'thinking', 'text', 'tool_use', 'tool_result', 'result']);
  assert.equal(events[0].data.sessionId, 'sess-1');
  assert.deepEqual(events[3].data, { id: 'tool-1', name: 'Read', input: { file_path: '/tmp/a.txt' } });
  assert.deepEqual(events[4].data, { toolUseId: 'tool-1', isError: false, text: 'file body' });
  assert.equal(events[5].data.costUsd, 0.25);
  assert.deepEqual(
    { ...result, stderrTail: '' },
    {
      exitCode: 0,
      sessionId: 'sess-1',
      resultText: 'all done',
      isError: false,
      costUsd: 0.25,
      inputTokens: 60,
      outputTokens: 5,
      numTurns: 3,
      subtype: 'success',
      timedOut: false,
      canceled: false,
      stderrTail: '',
    },
  );
});

test('surfaces non-JSON stdout lines as log events and keeps going', async () => {
  const { events, result } = await run('noise');
  const logs = events.filter((e) => e.type === 'log').map((e) => e.data.text);
  assert.deepEqual(logs, ['Warning: not json', '{"type": broken']);
  assert.ok(types(events).includes('result'));
  assert.equal(result.isError, false);
  assert.equal(result.sessionId, 'sess-1');
});

test('reports an error result with its subtype', async () => {
  const { events, result } = await run('error-result');
  assert.equal(result.isError, true);
  assert.equal(result.subtype, 'error_max_turns');
  assert.equal(result.resultText, 'ran out of turns');
  assert.equal(result.exitCode, 0);
  assert.equal(events.at(-1)?.data.isError, true);
});

test('a non-zero exit without a result is an error with the stderr tail', async () => {
  const { events, result } = await run('crash');
  assert.equal(result.exitCode, 3);
  assert.equal(result.isError, true);
  assert.equal(result.resultText, null);
  assert.equal(result.costUsd, null);
  assert.equal(result.inputTokens, null);
  assert.equal(result.numTurns, null);
  assert.equal(result.subtype, null);
  assert.equal(result.sessionId, 'sess-1');
  assert.equal(result.stderrTail, 'boom: something broke\n');
  assert.deepEqual(events.filter((e) => e.type === 'stderr').map((e) => e.data.text), ['boom: something broke']);
});

test('kills a hung agent when the timeout elapses', async () => {
  const { result } = await run('hang', 500);
  assert.equal(result.timedOut, true);
  assert.equal(result.canceled, false);
  assert.equal(result.isError, true);
});

test('cancel kills a hung agent and marks it canceled', { timeout: 10_000 }, async () => {
  const events: AgentEvent[] = [];
  const handle = startAgent(spec('hang'), (e) => events.push(e));
  while (!events.some((e) => e.type === 'init')) await new Promise((r) => setTimeout(r, 20));
  handle.cancel();
  const result = await handle.done;
  assert.equal(result.canceled, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.isError, true);
});

test('cancel after the process has finished is a no-op', async () => {
  const handle = startAgent(spec('success'), () => {});
  const result = await handle.done;
  handle.cancel();
  assert.equal(result.canceled, false);
});
