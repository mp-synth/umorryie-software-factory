import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { MODEL_VERSIONS, MODELS, type Model, type RunEventType } from '@factory/shared';
import { redactDeep, type Redact } from '../agent-env.ts';
import { config } from '../config.ts';
import { exec, killTree } from '../git.ts';
import { repoShellEnv } from '../shell-env.ts';
import { launchSpooled, superviseSpool, type SpoolExit, type SpoolHandle, type SpoolLine, type SpoolOffsets } from './spool.ts';

export interface AgentSpec {
  cwd: string;
  model: string;
  effort?: string | null;
  rolePrompt: string;
  prompt: string;
  tools: string[];
  disallowedTools?: string[];
  addDirs: string[];
  timeoutMs: number;
  maxBudgetUsd?: number | null;
  loadUserSettings: boolean;
  env?: Record<string, string>;
  redact?: Redact;
  /** Continue this earlier session (forked, so the earlier one stays as it was) instead of starting a fresh one. */
  resumeSession?: string | null;
}

export interface AgentResult {
  exitCode: number;
  sessionId: string | null;
  resultText: string | null;
  isError: boolean;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  numTurns: number | null;
  subtype: string | null;
  timedOut: boolean;
  stalled: boolean;
  canceled: boolean;
  stderrTail: string;
}

const KILL_LINGERING_PROCESSES_AFTER_RESULT_MS = 30_000;
// No agent tool call may run this long (Bash stops at 10 minutes), so this much silence means it hung.
export const AGENT_STALL_MS = 20 * 60_000;
// Agents and the tools they run yield to the server, so a machine full of agents still answers the UI and schedules work.
const AGENT_NICE = 5;

export interface AgentEvent {
  type: RunEventType;
  data: Record<string, unknown>;
}

export interface AgentHandle {
  pid: number | undefined;
  scratchDir: string | null;
  done: Promise<AgentResult>;
  cancel: () => void;
}

let cachedBin: string | null | undefined;

export function resolveClaudeBin(): string | null {
  if (cachedBin !== undefined) return cachedBin;
  const candidates = [
    config.claudeBin,
    ...(process.env.PATH ?? '').split(path.delimiter).map((d) => path.join(d, 'claude')),
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    path.join(os.homedir(), '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ].filter(Boolean) as string[];
  cachedBin = candidates.find((c) => {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return fs.statSync(c).isFile();
    } catch {
      return false;
    }
  }) ?? null;
  return cachedBin;
}

/**
 * Whether an agent can work right now: the smallest model answers one word. Returns what it printed when it
 * could not (signed out, out of allowance), or null when it answered.
 */
export async function probeAgent(model: string | null = null): Promise<string | null> {
  const bin = resolveClaudeBin();
  if (!bin) return 'claude CLI not found';
  const r = await exec(bin, ['-p', 'Reply with the word ok.', '--model', cliModel(model ?? 'haiku'), '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'], {
    timeoutMs: 120_000,
    env: { ...freshAgentEnv(), ...CONTEXT_FREE_SESSION },
    cwd: os.tmpdir(),
  });
  if (r.code !== 0) return (r.stdout + r.stderr).trim().slice(0, 300) || `claude exited ${r.code}`;
  try {
    const result = JSON.parse(r.stdout) as { is_error?: boolean; result?: string };
    return result.is_error ? String(result.result ?? 'error').slice(0, 300) : null;
  } catch {
    return null;
  }
}

export async function claudeVersion(): Promise<string | null> {
  const bin = resolveClaudeBin();
  if (!bin) return null;
  const r = await exec(bin, ['--version'], { timeoutMs: 15_000, env: freshAgentEnv() });
  return r.code === 0 ? r.stdout.trim() : null;
}

const CLAUDE_AUTH_VARIABLES = new Set(['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CONFIG_DIR']);

const SESSION_SCOPED_AUTH_VARIABLES = new Set(['ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN']);

function belongsToParentClaudeSession(name: string, serverRunsInsideClaudeSession: boolean): boolean {
  if (CLAUDE_AUTH_VARIABLES.has(name)) return false;
  if (SESSION_SCOPED_AUTH_VARIABLES.has(name)) return serverRunsInsideClaudeSession;
  return name.startsWith('CLAUDE') || name.startsWith('MCP_');
}

export function freshAgentEnv(): NodeJS.ProcessEnv {
  const insideClaudeSession = !!process.env.CLAUDECODE;
  return Object.fromEntries(Object.entries(repoShellEnv()).filter(([name]) => !belongsToParentClaudeSession(name, insideClaudeSession)));
}

const CONTEXT_FREE_SESSION = { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };
const SHORT_ENOUGH_FOR_UNIX_SOCKETS = '/tmp';

export function makeScratchDir(): string | null {
  for (const base of [SHORT_ENOUGH_FOR_UNIX_SOCKETS, os.tmpdir()]) {
    try {
      return fs.mkdtempSync(path.join(base, 'factory-agent-'));
    } catch {
      continue;
    }
  }
  return null;
}

const PRODUCTION_VARIABLE = /(^|[^A-Z0-9])(PROD|PRD|PRODUCTION|LIVE)\d*([^A-Z0-9]|$)/i;

export function isProductionVariable(name: string): boolean {
  return PRODUCTION_VARIABLE.test(name);
}

function withoutProductionVariables(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !isProductionVariable(name)));
}

export function isolatedAgentEnv(spec: Pick<AgentSpec, 'env'>, scratchDir: string | null): NodeJS.ProcessEnv {
  return { ...withoutProductionVariables({ ...freshAgentEnv(), ...spec.env }), ...CONTEXT_FREE_SESSION, ...(scratchDir ? { TMPDIR: scratchDir } : {}) };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}… [${s.length - n} more chars]` : s;
}

function compactInput(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = typeof v === 'string' ? truncate(v, 1500) : v;
  }
  return out;
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : ''))
      .join('\n');
  }
  return '';
}

/** A factory model name runs its pinned version with the 1M context window, whatever the CLI's aliases point at. Any other name passes through. */
export function cliModel(model: string): string {
  return (MODELS as readonly string[]).includes(model) ? `${MODEL_VERSIONS[model as Model].id}[1m]` : model;
}

export function buildArgs(spec: AgentSpec): string[] {
  const args = [
    '-p', spec.prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--model', cliModel(spec.model),
    '--append-system-prompt', spec.rolePrompt,
    '--permission-mode', 'bypassPermissions',
    '--tools', spec.tools.join(','),
    ...(spec.disallowedTools?.length ? ['--disallowed-tools', ...spec.disallowedTools] : []),
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--setting-sources', spec.loadUserSettings ? 'user,project,local' : 'project,local',
  ];
  if (spec.effort) args.push('--effort', spec.effort);
  if (spec.resumeSession) args.push('--resume', spec.resumeSession, '--fork-session');
  if (spec.maxBudgetUsd) args.push('--max-budget-usd', String(spec.maxBudgetUsd));
  for (const d of spec.addDirs) args.push('--add-dir', d);
  return args;
}

export function agentStream(redact: Redact = (text) => text) {
  let sessionId: string | null = null;
  let result: Record<string, any> | null = null;
  let stderrTail = '';

  const eventsOf = (msg: Record<string, any>): AgentEvent[] => {
    switch (msg.type) {
      case 'system':
        if (msg.subtype !== 'init') return [];
        sessionId = msg.session_id ?? null;
        return [{ type: 'init', data: { model: msg.model, sessionId, cwd: msg.cwd, tools: msg.tools } }];
      case 'assistant':
        return (msg.message?.content ?? []).flatMap((block: Record<string, any>): AgentEvent[] => {
          if (block.type === 'text' && block.text?.trim()) return [{ type: 'text', data: { text: block.text } }];
          if (block.type === 'thinking' && block.thinking?.trim()) return [{ type: 'thinking', data: { text: truncate(block.thinking, 4000) } }];
          if (block.type === 'tool_use') return [{ type: 'tool_use', data: { id: block.id, name: block.name, input: compactInput(block.input) } }];
          return [];
        });
      case 'user':
        return (msg.message?.content ?? [])
          .filter((block: Record<string, any>) => block.type === 'tool_result')
          .map((block: Record<string, any>): AgentEvent => ({
            type: 'tool_result',
            data: { toolUseId: block.tool_use_id, isError: !!block.is_error, text: truncate(toolResultText(block.content), 3000) },
          }));
      case 'result':
        result = msg;
        return [
          {
            type: 'result',
            data: {
              isError: !!msg.is_error,
              subtype: msg.subtype,
              costUsd: msg.total_cost_usd,
              durationMs: msg.duration_ms,
              numTurns: msg.num_turns,
              text: typeof msg.result === 'string' ? truncate(msg.result, 4000) : null,
            },
          },
        ];
      default:
        return [];
    }
  };

  return {
    stdout(line: string): AgentEvent[] {
      if (!line.trim()) return [];
      try {
        return eventsOf(redactDeep(JSON.parse(line), redact));
      } catch {
        return [{ type: 'log', data: { text: truncate(redact(line), 2000) } }];
      }
    },
    stderr(raw: string): AgentEvent[] {
      const line = redact(raw);
      stderrTail = `${stderrTail}${line}\n`.slice(-8000);
      return line.trim() ? [{ type: 'stderr', data: { text: truncate(line, 2000) } }] : [];
    },
    note(text: string): void {
      stderrTail += text;
    },
    sawResult: (): boolean => result !== null,
    result(end: { exitCode: number; timedOut: boolean; stalled: boolean; canceled: boolean }): AgentResult {
      const usage = (result?.usage ?? {}) as Record<string, number>;
      return {
        exitCode: end.exitCode,
        sessionId,
        resultText: typeof result?.result === 'string' ? result.result : null,
        isError: !result || !!result.is_error,
        costUsd: typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : null,
        inputTokens: result
          ? (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
          : null,
        outputTokens: result ? usage.output_tokens ?? 0 : null,
        numTurns: typeof result?.num_turns === 'number' ? result.num_turns : null,
        subtype: typeof result?.subtype === 'string' ? result.subtype : null,
        timedOut: end.timedOut,
        stalled: end.stalled,
        canceled: end.canceled,
        stderrTail,
      };
    },
  };
}

const CLAUDE_NOT_FOUND: AgentResult = {
  exitCode: 127, sessionId: null, resultText: null, isError: true, costUsd: null, inputTokens: null,
  outputTokens: null, numTurns: null, subtype: null, timedOut: false, stalled: false, canceled: false,
  stderrTail: 'claude CLI not found. Install Claude Code or set CLAUDE_BIN in .env.',
};

export function startAgent(spec: AgentSpec, onEvent: (e: AgentEvent) => void): AgentHandle {
  const bin = resolveClaudeBin();
  if (!bin) return { pid: undefined, scratchDir: null, cancel: () => {}, done: Promise.resolve(CLAUDE_NOT_FOUND) };

  const scratchDir = makeScratchDir();
  const child = spawn(bin, buildArgs(spec), {
    cwd: spec.cwd,
    env: isolatedAgentEnv(spec, scratchDir),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  const stream = agentStream(spec.redact);
  let timedOut = false;
  let stalled = false;
  let canceled = false;
  let exited = false;
  let lingeringProcessesTimer: NodeJS.Timeout | null = null;

  const timer = setTimeout(() => {
    timedOut = true;
    killTree(child.pid);
  }, spec.timeoutMs);
  let stallTimer: NodeJS.Timeout | null = null;
  const noteProgress = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      killTree(child.pid);
    }, AGENT_STALL_MS);
  };
  noteProgress();

  child.on('exit', () => {
    exited = true;
  });

  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    noteProgress();
    stream.stdout(line).forEach(onEvent);
    if (stream.sawResult()) lingeringProcessesTimer ??= setTimeout(() => killTree(child.pid), KILL_LINGERING_PROCESSES_AFTER_RESULT_MS);
  });

  const stderrLines = readline.createInterface({ input: child.stderr });
  stderrLines.on('line', (line) => {
    noteProgress();
    stream.stderr(line).forEach(onEvent);
  });

  const done = new Promise<AgentResult>((resolve) => {
    const finish = (code: number | null) => {
      clearTimeout(timer);
      if (stallTimer) clearTimeout(stallTimer);
      if (lingeringProcessesTimer) clearTimeout(lingeringProcessesTimer);
      lines.close();
      stderrLines.close();
      if (scratchDir) fs.rm(scratchDir, { recursive: true, force: true }, () => {});
      resolve(stream.result({ exitCode: code ?? 1, timedOut, stalled, canceled }));
    };
    child.on('error', (err) => {
      stream.note(String(err));
      finish(127);
    });
    child.on('close', finish);
  });

  return {
    pid: child.pid,
    scratchDir,
    done,
    cancel: () => {
      if (exited) return;
      canceled = true;
      killTree(child.pid);
    },
  };
}

export type AgentSink = (events: AgentEvent[], offsets: SpoolOffsets) => Promise<void>;
export type DetachedAgentHandle = AgentHandle & Pick<SpoolHandle<AgentResult>, 'leave' | 'abandon'>;

const NOTHING_STORED: SpoolOffsets = { stdout: 0, stderr: 0 };
const SUPERVISOR_LOST = "The agent's supervisor process disappeared before it recorded an exit.\n";

function followAgent(
  dir: string,
  opts: { pid: number | undefined; scratchDir: string | null; from: SpoolOffsets; redact?: Redact },
  sink: AgentSink,
): DetachedAgentHandle {
  const stream = agentStream(opts.redact);
  const stored = { ...opts.from };
  const onLines = async (lines: SpoolLine[]) => {
    const fresh: AgentEvent[] = [];
    for (const line of lines) {
      const events = stream[line.stream](line.text);
      if (line.end <= stored[line.stream]) continue;
      stored[line.stream] = line.end;
      fresh.push(...events);
    }
    if (fresh.length) await sink(fresh, { ...stored });
  };
  const conclude = (exit: SpoolExit | null, cancelRequested: boolean): AgentResult => {
    if (!exit) stream.note(SUPERVISOR_LOST);
    return stream.result({ exitCode: exit?.code ?? 1, timedOut: !!exit?.timedOut, stalled: !!exit?.stalled, canceled: cancelRequested || !!exit?.canceled });
  };
  return { ...superviseSpool(dir, opts.pid, onLines, conclude), scratchDir: opts.scratchDir };
}

export function startDetachedAgent(spec: AgentSpec, dir: string, sink: AgentSink, marker?: string): DetachedAgentHandle {
  const bin = resolveClaudeBin();
  if (!bin) return { pid: undefined, scratchDir: null, cancel: () => {}, leave: () => {}, abandon: () => {}, done: Promise.resolve(CLAUDE_NOT_FOUND) };
  const scratchDir = makeScratchDir();
  const pid = launchSpooled(
    dir,
    { bin, args: buildArgs(spec), cwd: spec.cwd, timeoutMs: spec.timeoutMs, lingerAfterResultMs: KILL_LINGERING_PROCESSES_AFTER_RESULT_MS, stallMs: AGENT_STALL_MS, scratchDir, marker, nice: AGENT_NICE },
    isolatedAgentEnv(spec, scratchDir),
  );
  return followAgent(dir, { pid, scratchDir, from: NOTHING_STORED, redact: spec.redact }, sink);
}

export function attachAgent(dir: string, from: SpoolOffsets, redact: Redact | undefined, sink: AgentSink): DetachedAgentHandle {
  return followAgent(dir, { pid: undefined, scratchDir: null, from, redact }, sink);
}
