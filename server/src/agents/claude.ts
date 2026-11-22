import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import type { RunEventType } from '@factory/shared';
import { redactDeep, type Redact } from '../agent-env.ts';
import { config } from '../config.ts';
import { exec, killTree } from '../git.ts';
import { repoShellEnv } from '../shell-env.ts';

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
  canceled: boolean;
  stderrTail: string;
}

const KILL_LINGERING_PROCESSES_AFTER_RESULT_MS = 30_000;

export interface AgentEvent {
  type: RunEventType;
  data: Record<string, unknown>;
}

export interface AgentHandle {
  pid: number | undefined;
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

export function buildArgs(spec: AgentSpec): string[] {
  const args = [
    '-p', spec.prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--model', spec.model,
    '--append-system-prompt', spec.rolePrompt,
    '--permission-mode', 'bypassPermissions',
    '--tools', spec.tools.join(','),
    ...(spec.disallowedTools?.length ? ['--disallowed-tools', ...spec.disallowedTools] : []),
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--setting-sources', spec.loadUserSettings ? 'user,project,local' : 'project,local',
  ];
  if (spec.effort) args.push('--effort', spec.effort);
  if (spec.maxBudgetUsd) args.push('--max-budget-usd', String(spec.maxBudgetUsd));
  for (const d of spec.addDirs) args.push('--add-dir', d);
  return args;
}

export function startAgent(spec: AgentSpec, onEvent: (e: AgentEvent) => void): AgentHandle {
  const bin = resolveClaudeBin();
  if (!bin) {
    return {
      pid: undefined,
      cancel: () => {},
      done: Promise.resolve({
        exitCode: 127, sessionId: null, resultText: null, isError: true, costUsd: null, inputTokens: null,
        outputTokens: null, numTurns: null, subtype: null, timedOut: false, canceled: false,
        stderrTail: 'claude CLI not found. Install Claude Code or set CLAUDE_BIN in .env.',
      }),
    };
  }

  const child = spawn(bin, buildArgs(spec), {
    cwd: spec.cwd,
    env: { ...freshAgentEnv(), ...spec.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  let sessionId: string | null = null;
  let result: Record<string, unknown> | null = null;
  let stderrTail = '';
  let timedOut = false;
  let canceled = false;
  let exited = false;
  let lingeringProcessesTimer: NodeJS.Timeout | null = null;
  const redact = spec.redact ?? ((text: string) => text);

  const timer = setTimeout(() => {
    timedOut = true;
    killTree(child.pid);
  }, spec.timeoutMs);

  child.on('exit', () => {
    exited = true;
  });

  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let msg: Record<string, any>;
    try {
      msg = redactDeep(JSON.parse(line), redact);
    } catch {
      onEvent({ type: 'log', data: { text: truncate(redact(line), 2000) } });
      return;
    }
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          sessionId = msg.session_id ?? null;
          onEvent({ type: 'init', data: { model: msg.model, sessionId, cwd: msg.cwd, tools: msg.tools } });
        }
        break;
      case 'assistant':
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'text' && block.text?.trim()) onEvent({ type: 'text', data: { text: block.text } });
          else if (block.type === 'thinking' && block.thinking?.trim())
            onEvent({ type: 'thinking', data: { text: truncate(block.thinking, 4000) } });
          else if (block.type === 'tool_use')
            onEvent({ type: 'tool_use', data: { id: block.id, name: block.name, input: compactInput(block.input) } });
        }
        break;
      case 'user':
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'tool_result') {
            onEvent({
              type: 'tool_result',
              data: { toolUseId: block.tool_use_id, isError: !!block.is_error, text: truncate(toolResultText(block.content), 3000) },
            });
          }
        }
        break;
      case 'result':
        result = msg;
        lingeringProcessesTimer ??= setTimeout(() => killTree(child.pid), KILL_LINGERING_PROCESSES_AFTER_RESULT_MS);
        onEvent({
          type: 'result',
          data: {
            isError: !!msg.is_error,
            subtype: msg.subtype,
            costUsd: msg.total_cost_usd,
            durationMs: msg.duration_ms,
            numTurns: msg.num_turns,
            text: typeof msg.result === 'string' ? truncate(msg.result, 4000) : null,
          },
        });
        break;
      default:
        break;
    }
  });

  const stderrLines = readline.createInterface({ input: child.stderr });
  stderrLines.on('line', (raw) => {
    const line = redact(raw);
    stderrTail = `${stderrTail}${line}\n`.slice(-8000);
    if (line.trim()) onEvent({ type: 'stderr', data: { text: truncate(line, 2000) } });
  });

  const done = new Promise<AgentResult>((resolve) => {
    const finish = (code: number | null) => {
      clearTimeout(timer);
      if (lingeringProcessesTimer) clearTimeout(lingeringProcessesTimer);
      lines.close();
      stderrLines.close();
      const r = result as Record<string, any> | null;
      const usage = (r?.usage ?? {}) as Record<string, number>;
      resolve({
        exitCode: code ?? 1,
        sessionId,
        resultText: typeof r?.result === 'string' ? r.result : null,
        isError: !r || !!r.is_error,
        costUsd: typeof r?.total_cost_usd === 'number' ? r.total_cost_usd : null,
        inputTokens: r
          ? (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
          : null,
        outputTokens: r ? usage.output_tokens ?? 0 : null,
        numTurns: typeof r?.num_turns === 'number' ? r.num_turns : null,
        subtype: typeof r?.subtype === 'string' ? r.subtype : null,
        timedOut,
        canceled,
        stderrTail,
      });
    };
    child.on('error', (err) => {
      stderrTail += String(err);
      finish(127);
    });
    child.on('close', finish);
  });

  return {
    pid: child.pid,
    done,
    cancel: () => {
      if (exited) return;
      canceled = true;
      killTree(child.pid);
    },
  };
}
