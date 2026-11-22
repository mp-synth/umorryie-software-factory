import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { AgentEvent, AgentSpec } from './claude.ts';
import type { SpoolOffsets } from './spool.ts';

process.env.CLAUDE_BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.mjs');

const { attachAgent, buildArgs, startAgent, startDetachedAgent } = await import('./claude.ts');
const { LeftRunning, readExit, removeSpool } = await import('./spool.ts');

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

test('runs each factory model on its pinned version with the 1M context window', () => {
  const modelArg = (model: string) => {
    const args = buildArgs({ ...spec('success'), model });
    return args[args.indexOf('--model') + 1];
  };
  assert.equal(modelArg('fable'), 'claude-fable-5-2[1m]');
  assert.equal(modelArg('opus'), 'claude-opus-5-5[1m]');
  assert.equal(modelArg('sonnet'), 'claude-sonnet-5-5[1m]');
  assert.equal(modelArg('haiku'), 'claude-haiku-5-5[1m]');
  assert.equal(modelArg('fake-model'), 'fake-model');
});

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

async function environmentOf(env: Record<string, string> = {}) {
  const handle = startAgent({ ...spec('environment'), env: { FAKE_SCENARIO: 'environment', ...env } }, () => {});
  const scratchWhileRunning = !!handle.scratchDir && fs.statSync(handle.scratchDir).isDirectory();
  const result = await handle.done;
  return { handle, scratchWhileRunning, seen: JSON.parse(result.resultText!) as { tmpdir: string | null; autoMemoryOff: string | null } };
}

test('gives every agent a scratch directory of its own as TMPDIR', async () => {
  const [a, b] = await Promise.all([environmentOf(), environmentOf()]);
  assert.ok(a.scratchWhileRunning && b.scratchWhileRunning);
  assert.equal(a.seen.tmpdir, a.handle.scratchDir);
  assert.equal(b.seen.tmpdir, b.handle.scratchDir);
  assert.notEqual(a.seen.tmpdir, b.seen.tmpdir);
});

test('keeps the scratch path short enough for unix sockets', async () => {
  const { handle } = await environmentOf();
  assert.ok(handle.scratchDir!.length < 40, handle.scratchDir!);
});

test('removes the scratch directory when the agent exits', async () => {
  const { handle } = await environmentOf();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(fs.existsSync(handle.scratchDir!), false);
});

test("starts every session without Claude's auto memory, whatever the repo env files say", async () => {
  const { seen, handle } = await environmentOf({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0', TMPDIR: '/somewhere/shared' });
  assert.equal(seen.autoMemoryOff, '1');
  assert.equal(seen.tmpdir, handle.scratchDir);
});

const spools: string[] = [];
after(() => spools.forEach(removeSpool));

function newSpool(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-spool-'));
  spools.push(dir);
  return dir;
}

function stored() {
  const events: AgentEvent[] = [];
  let readUpTo: SpoolOffsets = { stdout: 0, stderr: 0 };
  const sink = async (batch: AgentEvent[], offsets: SpoolOffsets) => {
    events.push(...batch);
    readUpTo = offsets;
  };
  return { events, sink, readUpTo: () => readUpTo };
}

const slow = (steps: number): AgentSpec => ({ ...spec('slow'), env: { FAKE_SCENARIO: 'slow', FAKE_STEPS: String(steps), FAKE_STEP_MS: '60' } });
const texts = (events: AgentEvent[]) => events.filter((e) => e.type === 'text').map((e) => e.data.text);

async function waitFor(condition: () => boolean): Promise<void> {
  while (!condition()) await new Promise((r) => setTimeout(r, 20));
}

test('a detached agent produces the same events and result as an attached one', async () => {
  const attached = await run('success');
  const db = stored();
  const result = await startDetachedAgent(spec('success'), newSpool(), db.sink).done;
  assert.deepEqual(db.events, attached.events);
  assert.deepEqual(result, attached.result);
});

test('a detached agent that crashes reports its exit code and stderr', async () => {
  const db = stored();
  const result = await startDetachedAgent(spec('crash'), newSpool(), db.sink).done;
  assert.equal(result.exitCode, 3);
  assert.equal(result.stderrTail, 'boom: something broke\n');
  assert.deepEqual(db.events.filter((e) => e.type === 'stderr').map((e) => e.data.text), ['boom: something broke']);
});

test('an agent picked up after the server left it yields every event once and the full result', { timeout: 15_000 }, async () => {
  const dir = newSpool();
  const db = stored();
  const first = startDetachedAgent(slow(8), dir, db.sink);
  await waitFor(() => texts(db.events).length >= 3);
  first.leave();
  await assert.rejects(first.done, LeftRunning);
  const seenBeforeLeaving = db.events.length;
  const result = await attachAgent(dir, db.readUpTo(), undefined, db.sink).done;
  assert.ok(db.events.length > seenBeforeLeaving);
  assert.deepEqual(types(db.events), ['init', ...Array(8).fill('text'), 'result']);
  assert.deepEqual(texts(db.events), [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `step ${n}`));
  assert.equal(result.sessionId, 'sess-1');
  assert.equal(result.costUsd, 0.25);
  assert.equal(result.isError, false);
  assert.equal(result.canceled, false);
});

test('an agent that finished while nobody followed is collected with only the events not stored yet', { timeout: 15_000 }, async () => {
  const dir = newSpool();
  const db = stored();
  const first = startDetachedAgent(slow(4), dir, db.sink);
  await waitFor(() => db.events.length >= 2);
  first.leave();
  await assert.rejects(first.done, LeftRunning);
  await waitFor(() => !!readExit(dir));
  const result = await attachAgent(dir, db.readUpTo(), undefined, db.sink).done;
  assert.deepEqual(types(db.events), ['init', ...Array(4).fill('text'), 'result']);
  assert.equal(result.resultText, 'all done');
  assert.equal(result.exitCode, 0);
});

test('collecting a finished agent again from the end stores nothing twice', async () => {
  const dir = newSpool();
  const db = stored();
  await startDetachedAgent(spec('success'), dir, db.sink).done;
  const before = db.events.length;
  const result = await attachAgent(dir, db.readUpTo(), undefined, db.sink).done;
  assert.equal(db.events.length, before);
  assert.equal(result.sessionId, 'sess-1');
  assert.equal(result.numTurns, 3);
});

test('cancel reaches an agent that was picked up again', { timeout: 15_000 }, async () => {
  const dir = newSpool();
  const db = stored();
  const first = startDetachedAgent(spec('hang'), dir, db.sink);
  await waitFor(() => db.events.some((e) => e.type === 'init'));
  first.leave();
  await assert.rejects(first.done, LeftRunning);
  const again = attachAgent(dir, db.readUpTo(), undefined, db.sink);
  again.cancel();
  const result = await again.done;
  assert.equal(result.canceled, true);
  assert.equal(result.isError, true);
  assert.deepEqual(types(db.events), ['init']);
});

test('the supervisor times a detached agent out', async () => {
  const result = await startDetachedAgent(spec('hang', 400), newSpool(), stored().sink).done;
  assert.equal(result.timedOut, true);
  assert.equal(result.canceled, false);
});

test('a detached agent gets its own scratch directory, removed at exit even when nobody followed', { timeout: 15_000 }, async () => {
  const dir = newSpool();
  const db = stored();
  const handle = startDetachedAgent({ ...spec('environment'), env: { FAKE_SCENARIO: 'environment' } }, dir, db.sink);
  const scratchDir = handle.scratchDir!;
  assert.ok(fs.statSync(scratchDir).isDirectory());
  handle.leave();
  await assert.rejects(handle.done, LeftRunning);
  await waitFor(() => !!readExit(dir));
  assert.equal(fs.existsSync(scratchDir), false);
  const result = await attachAgent(dir, db.readUpTo(), undefined, db.sink).done;
  assert.equal(JSON.parse(result.resultText!).tmpdir, scratchDir);
});

test('redacts secrets from events of an agent that is picked up again', async () => {
  const dir = newSpool();
  const db = stored();
  const first = startDetachedAgent(spec('success'), dir, db.sink);
  first.leave();
  await assert.rejects(first.done, LeftRunning);
  await waitFor(() => !!readExit(dir));
  const redact = (text: string) => text.split('file body').join('[redacted]');
  await attachAgent(dir, { stdout: 0, stderr: 0 }, redact, db.sink).done;
  assert.equal(db.events.find((e) => e.type === 'tool_result')?.data.text, '[redacted]');
});
