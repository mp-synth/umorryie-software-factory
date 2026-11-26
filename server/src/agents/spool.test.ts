import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  LeftRunning,
  abandonSpool,
  fateOf,
  followCommand,
  followSpool,
  launchSpooled,
  readExit,
  removeSpool,
  splitLines,
  spoolFate,
  superviseSpool,
  wasLaunched,
  type SpoolLaunch,
  type SpoolLine,
} from './spool.ts';

const fakeAgent = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.mjs');
const POLL = { pollMs: 20 };
const spools: string[] = [];

after(() => spools.forEach(removeSpool));

function newSpool(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-spool-'));
  spools.push(dir);
  return dir;
}

const markerOf = (dir: string) => `marker-${path.basename(dir)}`;

function launch(dir: string, scenario: string, over: Partial<SpoolLaunch> = {}, env: Record<string, string> = {}): number | undefined {
  const fake: SpoolLaunch = { bin: process.execPath, args: [fakeAgent, markerOf(dir)], cwd: process.cwd(), timeoutMs: 10_000, marker: markerOf(dir) };
  return launchSpooled(dir, { ...fake, ...over }, { ...process.env, FAKE_SCENARIO: scenario, ...env });
}

function shell(dir: string, command: string, timeoutMs = 10_000): number | undefined {
  return launchSpooled(dir, { bin: 'bash', args: ['-c', command], cwd: process.cwd(), timeoutMs }, process.env);
}

async function until(condition: () => boolean, timeoutMs = 8000): Promise<void> {
  for (const deadline = Date.now() + timeoutMs; !condition(); ) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function followAll(dir: string) {
  const lines: SpoolLine[] = [];
  const end = await followSpool(dir, async (batch) => void lines.push(...batch), POLL).done;
  return { lines, end };
}

const meta = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as { pid: number; agentPid: number };

function runs(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const typesOf = (lines: SpoolLine[]) => lines.filter((l) => l.stream === 'stdout').map((l) => JSON.parse(l.text).type);

test('splitLines returns whole lines with the offset after each and keeps the unfinished rest', () => {
  const { lines, rest } = splitLines(Buffer.from('one\ntwo\r\nthr'), 100);
  assert.deepEqual(lines, [
    { text: 'one', end: 104 },
    { text: 'two', end: 109 },
  ]);
  assert.equal(rest.toString(), 'thr');
});

test('splitLines counts offsets in bytes, not characters', () => {
  const { lines } = splitLines(Buffer.from('žiga\nb\n'), 0);
  assert.deepEqual(lines.map((l) => l.end), [6, 8]);
});

test('fateOf follows a live run, collects a finished one and interrupts what is gone or abandoned', () => {
  assert.equal(fateOf({ abandoned: false, exited: false, supervisorAlive: true }), 'follow');
  assert.equal(fateOf({ abandoned: false, exited: true, supervisorAlive: false }), 'collect');
  assert.equal(fateOf({ abandoned: false, exited: true, supervisorAlive: true }), 'collect');
  assert.equal(fateOf({ abandoned: false, exited: false, supervisorAlive: false }), 'interrupt');
  assert.equal(fateOf({ abandoned: true, exited: true, supervisorAlive: false }), 'interrupt');
  assert.equal(fateOf({ abandoned: true, exited: false, supervisorAlive: true }), 'interrupt');
});

test('follows a process to its exit and reports every line with the offset after it', async () => {
  const dir = newSpool();
  launch(dir, 'success');
  const { lines, end } = await followAll(dir);
  assert.deepEqual(end, { kind: 'exited', exit: { ...readExit(dir)!, code: 0, timedOut: false, canceled: false } });
  assert.deepEqual(typesOf(lines), ['system', 'assistant', 'user', 'result']);
  const stdout = lines.filter((l) => l.stream === 'stdout');
  assert.ok(stdout.every((l, i) => i === 0 || l.end > stdout[i - 1].end));
  assert.equal(stdout.at(-1)!.end, fs.statSync(path.join(dir, 'stdout.log')).size);
});

test('a second follower reads the same lines at the same offsets', async () => {
  const dir = newSpool();
  launch(dir, 'crash');
  const first = await followAll(dir);
  const second = await followAll(dir);
  assert.deepEqual(second.lines, first.lines);
  assert.equal(first.end.kind === 'exited' && first.end.exit.code, 3);
  assert.deepEqual(first.lines.filter((l) => l.stream === 'stderr').map((l) => l.text), ['boom: something broke']);
});

test('the process keeps running after its follower leaves, and the next follower sees it finish', async () => {
  const dir = newSpool();
  launch(dir, 'slow', {}, { FAKE_STEPS: '6', FAKE_STEP_MS: '80' });
  const seen: SpoolLine[] = [];
  const first = followSpool(dir, async (batch) => void seen.push(...batch), POLL);
  await until(() => seen.length >= 2);
  first.leave();
  assert.deepEqual(await first.done, { kind: 'left' });
  assert.equal(readExit(dir), null);
  const { lines, end } = await followAll(dir);
  assert.equal(end.kind, 'exited');
  assert.deepEqual(typesOf(lines), ['system', ...Array(6).fill('assistant'), 'result']);
  assert.deepEqual(lines.slice(0, seen.length), seen);
});

test('the supervisor enforces the timeout and removes the scratch directory with nobody following', async () => {
  const dir = newSpool();
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-agent-'));
  launch(dir, 'hang', { timeoutMs: 300, scratchDir });
  await until(() => !!readExit(dir));
  assert.equal(readExit(dir)!.timedOut, true);
  assert.equal(readExit(dir)!.canceled, false);
  assert.equal(fs.existsSync(scratchDir), false);
});

test('the supervisor stops a process that prints nothing for the stall time, long before its time limit', async () => {
  const dir = newSpool();
  launch(dir, 'hang', { timeoutMs: 10_000, stallMs: 300 });
  await until(() => !!readExit(dir), 4000);
  assert.deepEqual([readExit(dir)!.stalled, readExit(dir)!.timedOut, readExit(dir)!.canceled], [true, false, false]);
});

test('a process that keeps printing is not stalled, however long it runs', async () => {
  const dir = newSpool();
  launch(dir, 'slow', { stallMs: 400 }, { FAKE_STEPS: '10', FAKE_STEP_MS: '100' });
  const { end } = await followAll(dir);
  assert.deepEqual(end.kind === 'exited' && [end.exit.code, end.exit.stalled], [0, false]);
});

test('the supervisor stops a process that lingers after its result line', async () => {
  const dir = newSpool();
  launch(dir, 'linger', { lingerAfterResultMs: 200 });
  const { lines, end } = await followAll(dir);
  assert.deepEqual(typesOf(lines), ['system', 'result']);
  assert.deepEqual(end.kind === 'exited' && [end.exit.timedOut, end.exit.canceled], [false, false]);
});

test('cancel stops the process tree and the exit says it was canceled', async () => {
  const dir = newSpool();
  const pid = launch(dir, 'hang');
  const handle = superviseSpool(dir, pid, async () => {}, (exit, cancelRequested) => ({ exit, cancelRequested }), POLL);
  await until(() => fs.existsSync(path.join(dir, 'stdout.log')) && fs.statSync(path.join(dir, 'stdout.log')).size > 0);
  const { agentPid } = meta(dir);
  handle.cancel();
  const { exit, cancelRequested } = await handle.done;
  assert.equal(cancelRequested, true);
  assert.equal(exit?.canceled, true);
  assert.equal(runs(agentPid), false);
});

test('a handle that leaves rejects with LeftRunning and the process stays up', async () => {
  const dir = newSpool();
  const pid = launch(dir, 'hang');
  const handle = superviseSpool(dir, pid, async () => {}, () => 'done', POLL);
  await until(() => fs.existsSync(path.join(dir, 'meta.json')));
  handle.leave();
  await assert.rejects(handle.done, LeftRunning);
  assert.equal(await spoolFate(dir), 'follow');
  await abandonSpool(dir);
});

test('a supervisor that disappears is reported as lost and its orphaned process is stopped', async () => {
  const dir = newSpool();
  launch(dir, 'hang');
  await until(() => fs.existsSync(path.join(dir, 'stdout.log')) && fs.statSync(path.join(dir, 'stdout.log')).size > 0);
  const { pid, agentPid } = meta(dir);
  const follower = followSpool(dir, async () => {}, POLL);
  process.kill(pid, 'SIGKILL');
  assert.deepEqual(await follower.done, { kind: 'lost' });
  await until(() => !runs(agentPid));
  assert.equal(await spoolFate(dir), 'interrupt');
});

test('wasLaunched tells a spool whose process was started from one that only has a folder', async () => {
  const dir = newSpool();
  assert.equal(wasLaunched(dir), false);
  assert.equal(wasLaunched(path.join(dir, 'never-created')), false);
  launch(dir, 'success');
  assert.equal(wasLaunched(dir), true);
  await followSpool(dir, async () => {}, POLL).done;
});

test('spoolFate tells a running process from a finished and an abandoned one', async () => {
  const dir = newSpool();
  launch(dir, 'slow', {}, { FAKE_STEPS: '3', FAKE_STEP_MS: '100' });
  await until(() => fs.existsSync(path.join(dir, 'meta.json')));
  assert.equal(await spoolFate(dir), 'follow');
  await until(() => !!readExit(dir));
  assert.equal(await spoolFate(dir), 'collect');
  await abandonSpool(dir);
  assert.equal(await spoolFate(dir), 'interrupt');
});

test('abandoning a running spool stops its process and waits for the supervisor to go', async () => {
  const dir = newSpool();
  launch(dir, 'hang');
  await until(() => fs.existsSync(path.join(dir, 'stdout.log')) && fs.statSync(path.join(dir, 'stdout.log')).size > 0);
  const { pid, agentPid } = meta(dir);
  await abandonSpool(dir);
  assert.equal(runs(pid), false);
  assert.equal(runs(agentPid), false);
  assert.equal(readExit(dir)?.canceled, true);
});

test('a supervisor started on an abandoned spool never starts the process', async () => {
  const dir = newSpool();
  fs.writeFileSync(path.join(dir, 'abandoned'), '');
  launch(dir, 'success');
  await until(() => !!readExit(dir));
  assert.equal(fs.existsSync(path.join(dir, 'stdout.log')), false);
  assert.equal(readExit(dir)!.canceled, true);
});

test('followCommand returns the exit code and both streams, and reports output once', async () => {
  const dir = newSpool();
  const pid = shell(dir, 'echo one; echo two; echo oops >&2; exit 3');
  const reported: string[] = [];
  const outcome = await followCommand(dir, { pid, from: { stdout: 0, stderr: 0 }, maxOutput: 1000, ...POLL, onOutput: async (text) => void reported.push(text) }).done;
  assert.deepEqual(outcome, { code: 3, stdout: 'one\ntwo\n', stderr: 'oops\n', timedOut: false, canceled: false });
  assert.deepEqual(reported.join('').split('\n').filter(Boolean).sort(), ['one', 'oops', 'two']);
});

test('followCommand picked up later reports only the output after the stored offsets but returns all of it', async () => {
  const dir = newSpool();
  shell(dir, 'echo one; echo two; echo oops >&2');
  await until(() => !!readExit(dir));
  const reported: string[] = [];
  const afterFirstLine = { stdout: 'one\n'.length, stderr: 0 };
  const outcome = await followCommand(dir, { pid: undefined, from: afterFirstLine, maxOutput: 1000, ...POLL, onOutput: async (text) => void reported.push(text) }).done;
  assert.equal(outcome.stdout, 'one\ntwo\n');
  assert.deepEqual(reported.join('').split('\n').filter(Boolean).sort(), ['oops', 'two']);
});

test('followCommand reports a timeout enforced by the supervisor', async () => {
  const dir = newSpool();
  const pid = shell(dir, 'echo started; sleep 30', 300);
  const outcome = await followCommand(dir, { pid, from: { stdout: 0, stderr: 0 }, maxOutput: 1000, ...POLL, onOutput: async () => {} }).done;
  assert.equal(outcome.timedOut, true);
  assert.notEqual(outcome.code, 0);
  assert.equal(outcome.stdout, 'started\n');
});

test('a missing working directory is reported as a command that could not run', async () => {
  const dir = newSpool();
  launchSpooled(dir, { bin: 'bash', args: ['-c', 'true'], cwd: path.join(dir, 'missing'), timeoutMs: 5000 }, process.env);
  const outcome = await followCommand(dir, { pid: undefined, from: { stdout: 0, stderr: 0 }, maxOutput: 1000, ...POLL, onOutput: async () => {} }).done;
  assert.equal(outcome.code, 127);
  assert.match(outcome.stderr, /ENOENT/);
});
