import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, killTree, type ExecResult } from '../git.ts';

const RUNNER = fileURLToPath(new URL('./spool-runner.mjs', import.meta.url));
const POLL_MS = 200;
const READ_CHUNK_BYTES = 64 * 1024;
const SUPERVISOR_START_GRACE_MS = 15_000;
const SUPERVISOR_STOP_GRACE_MS = 15_000;
const SCRATCH_PREFIX = 'factory-agent-';
const NEWLINE = 0x0a;

export type SpoolStream = 'stdout' | 'stderr';
export type SpoolOffsets = Record<SpoolStream, number>;

export interface SpoolLaunch {
  bin: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  lingerAfterResultMs?: number;
  /** The file the agent's turn ends by writing; while it is missing the agent may linger `lingerForOutputMs` instead. */
  outputPath?: string;
  lingerForOutputMs?: number;
  stallMs?: number;
  scratchDir?: string | null;
  marker?: string;
  /** Lower CPU priority (nice value) for the command and everything it starts, so the server stays responsive. */
  nice?: number;
}

export interface SpoolExit {
  code: number | null;
  signal: string | null;
  timedOut: boolean;
  stalled?: boolean;
  canceled: boolean;
}

interface SpoolMeta {
  pid: number;
  agentPid?: number;
  startedAt: number;
}

export interface SpoolLine {
  stream: SpoolStream;
  text: string;
  end: number;
}

export type SpoolEnd = { kind: 'exited'; exit: SpoolExit } | { kind: 'lost' } | { kind: 'left' };
export type SpoolFate = 'follow' | 'collect' | 'interrupt';

export interface SpoolHandle<T> {
  pid: number | undefined;
  done: Promise<T>;
  cancel: () => void;
  leave: () => void;
  abandon: () => void;
}

export class LeftRunning extends Error {
  constructor() {
    super('the factory server stopped following this run; its process keeps running');
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export const readExit = (dir: string) => readJson<SpoolExit>(path.join(dir, 'exit.json'));
const readMeta = (dir: string) => readJson<SpoolMeta>(path.join(dir, 'meta.json'));
const readLaunch = (dir: string) => readJson<SpoolLaunch>(path.join(dir, 'launch.json'));
const abandonedMark = (dir: string) => path.join(dir, 'abandoned');
export const wasLaunched = (dir: string) => fs.existsSync(path.join(dir, 'launch.json'));

function signal(pid: number, sig: NodeJS.Signals | 0): boolean {
  try {
    process.kill(pid, sig);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function commandLineOf(pid: number): Promise<string | null> {
  const r = await exec('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { timeoutMs: 10_000 });
  return r.code === 0 ? r.stdout.trim() : null;
}

export function launchSpooled(dir: string, launch: SpoolLaunch, env: NodeJS.ProcessEnv): number | undefined {
  if (launch.marker && !launch.args.some((arg) => arg.includes(launch.marker!))) throw new Error('the spool marker must appear in the command line');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'launch.json'), JSON.stringify(launch));
  const supervisor = spawn(process.execPath, [RUNNER, dir], { cwd: dir, env, stdio: 'ignore', detached: true });
  supervisor.on('error', (err) => fs.appendFileSync(path.join(dir, 'stderr.log'), `could not start the run's supervisor: ${err.message}\n`));
  supervisor.unref();
  return supervisor.pid;
}

export function splitLines(bytes: Buffer, base: number): { lines: { text: string; end: number }[]; rest: Buffer } {
  const lines: { text: string; end: number }[] = [];
  let from = 0;
  for (let at = bytes.indexOf(NEWLINE, from); at !== -1; at = bytes.indexOf(NEWLINE, from)) {
    lines.push({ text: bytes.toString('utf8', from, at).replace(/\r$/, ''), end: base + at + 1 });
    from = at + 1;
  }
  return { lines, rest: bytes.subarray(from) };
}

function streamReader(file: string, stream: SpoolStream) {
  let consumed = 0;
  let unfinished: Buffer = Buffer.alloc(0);
  let fd: number | null = null;

  const readChunk = (): Buffer => {
    try {
      fd ??= fs.openSync(file, 'r');
    } catch {
      return Buffer.alloc(0);
    }
    const chunk = Buffer.alloc(READ_CHUNK_BYTES);
    return chunk.subarray(0, fs.readSync(fd, chunk, 0, chunk.length, consumed + unfinished.length));
  };

  return {
    read(): { lines: SpoolLine[]; more: boolean } {
      const chunk = readChunk();
      const { lines, rest } = splitLines(Buffer.concat([unfinished, chunk]), consumed);
      consumed += unfinished.length + chunk.length - rest.length;
      unfinished = rest;
      return { lines: lines.map((line) => ({ ...line, stream })), more: chunk.length === READ_CHUNK_BYTES };
    },
    lineWithoutNewline(): SpoolLine[] {
      if (!unfinished.length) return [];
      consumed += unfinished.length;
      const line = { stream, text: unfinished.toString('utf8'), end: consumed };
      unfinished = Buffer.alloc(0);
      return [line];
    },
    close(): void {
      if (fd !== null) fs.closeSync(fd);
      fd = null;
    },
  };
}

export function followSpool(
  dir: string,
  onLines: (lines: SpoolLine[]) => Promise<void>,
  opts: { pollMs?: number } = {},
): { done: Promise<SpoolEnd>; leave: () => void } {
  const readers = [streamReader(path.join(dir, 'stdout.log'), 'stdout'), streamReader(path.join(dir, 'stderr.log'), 'stderr')];
  const followedSince = Date.now();
  let supervisorPid: number | null = null;
  let left = false;

  const supervisorRuns = (): boolean => {
    supervisorPid ??= readMeta(dir)?.pid ?? null;
    if (supervisorPid === null) return Date.now() - followedSince < SUPERVISOR_START_GRACE_MS;
    return signal(supervisorPid, 0);
  };

  const readWhatIsThere = async (): Promise<void> => {
    for (let more = true; more && !left; ) {
      const reads = readers.map((reader) => reader.read());
      const lines = reads.flatMap((read) => read.lines);
      if (lines.length) await onLines(lines);
      more = reads.some((read) => read.more);
    }
  };

  const readToTheEnd = async (): Promise<void> => {
    await readWhatIsThere();
    const last = left ? [] : readers.flatMap((reader) => reader.lineWithoutNewline());
    if (last.length) await onLines(last);
  };

  const follow = async (): Promise<SpoolEnd> => {
    for (;;) {
      if (left) return { kind: 'left' };
      const stillRuns = supervisorRuns();
      const exit = readExit(dir);
      if (exit || !stillRuns) {
        await readToTheEnd();
        if (left) return { kind: 'left' };
        if (exit) return { kind: 'exited', exit };
        await killOrphanedProcess(dir);
        return { kind: 'lost' };
      }
      await readWhatIsThere();
      await sleep(opts.pollMs ?? POLL_MS);
    }
  };

  const done = follow().finally(() => readers.forEach((reader) => reader.close()));
  const leave = () => {
    left = true;
  };
  return { done, leave };
}

export function superviseSpool<T>(
  dir: string,
  pid: number | undefined,
  onLines: (lines: SpoolLine[]) => Promise<void>,
  conclude: (exit: SpoolExit | null, cancelRequested: boolean) => T,
  opts: { pollMs?: number } = {},
): SpoolHandle<T> {
  let ended = false;
  let cancelRequested = false;
  const follower = followSpool(dir, onLines, opts);
  const stopSupervisor = () => {
    const target = pid ?? readMeta(dir)?.pid;
    if (target) signal(target, 'SIGTERM');
  };
  const done = follower.done.then((end) => {
    ended = true;
    if (end.kind === 'left') throw new LeftRunning();
    return conclude(end.kind === 'exited' ? end.exit : null, cancelRequested);
  });
  return {
    pid,
    done,
    cancel: () => {
      if (ended) return;
      cancelRequested = true;
      stopSupervisor();
    },
    leave: follower.leave,
    abandon: () => {
      if (ended) return;
      fs.writeFileSync(abandonedMark(dir), '');
      stopSupervisor();
      follower.leave();
    },
  };
}

export type CommandOutcome = ExecResult & { canceled: boolean; signal?: string | null };

const SUPERVISOR_LOST = 'The supervisor of this process disappeared before it recorded an exit.';

export function followCommand(
  dir: string,
  opts: { pid: number | undefined; from: SpoolOffsets; maxOutput: number; pollMs?: number; onOutput: (text: string, offsets: SpoolOffsets) => Promise<void> },
): SpoolHandle<CommandOutcome> {
  const output: Record<SpoolStream, string> = { stdout: '', stderr: '' };
  const stored = { ...opts.from };
  const onLines = async (lines: SpoolLine[]) => {
    const read: Record<SpoolStream, string> = { stdout: '', stderr: '' };
    let fresh = '';
    for (const line of lines) {
      read[line.stream] += `${line.text}\n`;
      if (line.end <= stored[line.stream]) continue;
      stored[line.stream] = line.end;
      fresh += `${line.text}\n`;
    }
    output.stdout = (output.stdout + read.stdout).slice(-opts.maxOutput);
    output.stderr = (output.stderr + read.stderr).slice(-opts.maxOutput);
    if (fresh) await opts.onOutput(fresh, { ...stored });
  };
  const conclude = (exit: SpoolExit | null, cancelRequested: boolean): CommandOutcome => ({
    code: exit ? exit.code ?? 1 : 1,
    stdout: output.stdout,
    stderr: exit ? output.stderr : `${output.stderr}${SUPERVISOR_LOST}\n`,
    timedOut: !!exit?.timedOut,
    canceled: cancelRequested || !!exit?.canceled,
    signal: exit?.signal ?? null,
  });
  return superviseSpool(dir, opts.pid, onLines, conclude, { pollMs: opts.pollMs });
}

export function fateOf(spool: { abandoned: boolean; exited: boolean; supervisorAlive: boolean }): SpoolFate {
  if (spool.abandoned) return 'interrupt';
  if (spool.exited) return 'collect';
  return spool.supervisorAlive ? 'follow' : 'interrupt';
}

export async function supervisorAlive(dir: string): Promise<boolean> {
  const meta = readMeta(dir);
  if (!meta) return false;
  return (await commandLineOf(meta.pid))?.includes(dir) ?? false;
}

export async function spoolFate(dir: string): Promise<SpoolFate> {
  const alive = await supervisorAlive(dir);
  return fateOf({ abandoned: fs.existsSync(abandonedMark(dir)), exited: !!readExit(dir), supervisorAlive: alive });
}

async function killOrphanedProcess(dir: string): Promise<void> {
  const meta = readMeta(dir);
  const marker = readLaunch(dir)?.marker;
  if (!meta?.agentPid || !marker) return;
  if ((await commandLineOf(meta.agentPid))?.includes(marker)) killTree(meta.agentPid);
}

async function stopSupervisorAndWait(pid: number): Promise<void> {
  signal(pid, 'SIGTERM');
  for (const deadline = Date.now() + SUPERVISOR_STOP_GRACE_MS; signal(pid, 0) && Date.now() < deadline; ) await sleep(POLL_MS);
}

export async function abandonSpool(dir: string): Promise<void> {
  if (!fs.existsSync(dir)) return;
  fs.writeFileSync(abandonedMark(dir), '');
  const meta = readMeta(dir);
  if (meta && (await supervisorAlive(dir))) await stopSupervisorAndWait(meta.pid);
  else await killOrphanedProcess(dir);
}

function removeScratch(dir: string): void {
  const scratch = readLaunch(dir)?.scratchDir;
  if (scratch && path.basename(scratch).startsWith(SCRATCH_PREFIX)) fs.rmSync(scratch, { recursive: true, force: true });
}

export function removeSpool(dir: string): void {
  removeScratch(dir);
  fs.rmSync(dir, { recursive: true, force: true });
}
