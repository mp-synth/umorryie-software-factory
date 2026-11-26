#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const KILL_AFTER_TERM_MS = 5000;
const STOP_WAITING_FOR_OUTPUT_MS = 10_000;
const STOP_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'];

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
    writeAtomically('exit.json', { code, signal, timedOut, stalled, canceled, finishedAt: Date.now() });
  } finally {
    if (launch.scratchDir) fs.rmSync(launch.scratchDir, { recursive: true, force: true });
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
  child = spawn(launch.bin, launch.args, { cwd: launch.cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  writeAtomically('meta.json', { pid: process.pid, agentPid: child.pid, startedAt });
  setTimeout(() => {
    timedOut = true;
    stopProcessTree();
  }, launch.timeoutMs);
  for (const signal of STOP_SIGNALS) {
    process.on(signal, () => {
      canceled = true;
      stopProcessTree();
    });
  }
  // An agent prints a line for every message and tool result. Silence this long means a hung tool or
  // request, so stop it instead of waiting for the run's time limit.
  let stallTimer = null;
  const noteProgress = () => {
    if (!launch.stallMs) return;
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      stopProcessTree();
    }, launch.stallMs);
  };
  noteProgress();
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
  child.on('close', recordExit);
}

process.on('uncaughtException', fail);
run();
