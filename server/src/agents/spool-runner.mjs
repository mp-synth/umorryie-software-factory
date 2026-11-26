#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const KILL_AFTER_TERM_MS = 5000;
const STOP_WAITING_FOR_OUTPUT_MS = 10_000;
const STOP_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'];
const TICK_MS = 200;
// A gap between ticks this much longer than the tick is the machine sleeping, not the run working.
const ASLEEP_AFTER_MS = 30_000;

const dir = process.argv[2];
const inSpool = (name) => path.join(dir, name);
const launch = JSON.parse(fs.readFileSync(inSpool('launch.json'), 'utf8'));
const startedAt = Date.now();

let child = null;
let timedOut = false;
let stalled = false;
let canceled = false;
let stopping = false;
let recorded = false;

function writeAtomically(name, value) {
  fs.writeFileSync(inSpool(`${name}.tmp`), JSON.stringify(value));
  fs.renameSync(inSpool(`${name}.tmp`), inSpool(name));
}

function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      return;
    }
  }
}

function recordExit(code, signal) {
  if (recorded) return;
  recorded = true;
  try {
    if (launch.scratchDir) fs.rmSync(launch.scratchDir, { recursive: true, force: true });
    writeAtomically('exit.json', { code, signal, timedOut, stalled, canceled, finishedAt: Date.now() });
  } finally {
    process.exit(0);
  }
}

function stopProcessTree() {
  if (stopping || !child?.pid) return;
  stopping = true;
  const pid = child.pid;
  signalGroup(pid, 'SIGTERM');
  setTimeout(() => signalGroup(pid, 'SIGKILL'), KILL_AFTER_TERM_MS);
  setTimeout(() => recordExit(null, 'SIGKILL'), STOP_WAITING_FOR_OUTPUT_MS);
}

function isResultLine(line) {
  if (!line.includes('"type":"result"')) return false;
  try {
    return JSON.parse(line).type === 'result';
  } catch {
    return false;
  }
}

function resultWatcher(onResult) {
  let unfinished = '';
  let seen = false;
  return (chunk) => {
    if (seen) return;
    const lines = (unfinished + chunk.toString('utf8')).split('\n');
    unfinished = lines.pop();
    if (!lines.some(isResultLine)) return;
    seen = true;
    onResult();
  };
}

// Time limits count only the time the machine is awake: a laptop that sleeps under a run must not find it
// "timed out" or "stalled" the moment it wakes.
function awakeClock() {
  let awake = 0;
  let last = Date.now();
  const timers = [];
  const tick = () => {
    const now = Date.now();
    const gap = now - last;
    last = now;
    if (gap < ASLEEP_AFTER_MS) awake += gap;
    for (const t of timers) if (!t.fired && awake - t.from >= t.ms) {
      t.fired = true;
      t.fire();
    }
  };
  const interval = setInterval(tick, TICK_MS);
  interval.unref?.();
  return {
    after(ms, fire) {
      const t = { ms, fire, from: awake, fired: false };
      timers.push(t);
      return { restart: () => ((t.from = awake), (t.fired = false)), cancel: () => (t.fired = true) };
    },
    stop: () => clearInterval(interval),
  };
}

function fail(error) {
  try {
    fs.appendFileSync(inSpool('stderr.log'), `${error?.stack ?? error}\n`);
  } catch {
    process.exitCode = 1;
  }
  if (child?.pid) signalGroup(child.pid, 'SIGKILL');
  recordExit(127, null);
}

function run() {
  writeAtomically('meta.json', { pid: process.pid, startedAt });
  if (fs.existsSync(inSpool('abandoned'))) {
    canceled = true;
    return recordExit(null, null);
  }
  const out = fs.openSync(inSpool('stdout.log'), 'a');
  const err = fs.openSync(inSpool('stderr.log'), 'a');
  const [bin, args] = launch.nice ? ['nice', ['-n', String(launch.nice), launch.bin, ...launch.args]] : [launch.bin, launch.args];
  child = spawn(bin, args, { cwd: launch.cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  writeAtomically('meta.json', { pid: process.pid, agentPid: child.pid, startedAt });
  const clock = awakeClock();
  clock.after(launch.timeoutMs, () => {
    timedOut = true;
    stopProcessTree();
  });
  for (const signal of STOP_SIGNALS) {
    process.on(signal, () => {
      canceled = true;
      stopProcessTree();
    });
  }
  // An agent prints a line for every message and tool result. Silence this long means a hung tool or
  // request, so stop it instead of waiting for the run's time limit.
  const stall = launch.stallMs
    ? clock.after(launch.stallMs, () => {
        stalled = true;
        stopProcessTree();
      })
    : null;
  const noteProgress = () => stall?.restart();
  const watch = launch.lingerAfterResultMs ? resultWatcher(() => setTimeout(stopProcessTree, launch.lingerAfterResultMs)) : () => {};
  child.stdout.on('data', (chunk) => {
    fs.writeSync(out, chunk);
    noteProgress();
    watch(chunk);
  });
  child.stderr.on('data', (chunk) => {
    fs.writeSync(err, chunk);
    noteProgress();
  });
  child.on('error', fail);
  child.on('close', (code, signal) => {
    // The group leader can exit while a redirected background child survives. Kill the group before the
    // supervisor exits, otherwise process.exit cancels stopProcessTree's delayed SIGKILL.
    if (child?.pid) signalGroup(child.pid, 'SIGKILL');
    recordExit(code, signal);
  });
}

process.on('uncaughtException', fail);
run();
