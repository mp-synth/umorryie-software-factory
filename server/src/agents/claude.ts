import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import type { RunEventType } from '@factory/shared';
import { config } from '../config.ts';
import { exec, killTree } from '../git.ts';

export interface AgentSpec {
  cwd: string;
  model: string;
  effort?: string | null;
  /** Role instructions, appended to Claude Code's own system prompt. */
  rolePrompt: string;
  /** The step header: absolute paths to inputs and outputs. Nothing else. */
  prompt: string;
  tools: string[];
  addDirs: string[];
  timeoutMs: number;
  maxBudgetUsd?: number | null;
  loadUserSettings: boolean;
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
  timedOut: boolean;
  canceled: boolean;
  stderrTail: string;
}

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
  const r = await exec(bin, ['--version'], { timeoutMs: 15_000, env: agentEnv() });
  return r.code === 0 ? r.stdout.trim() : null;
}

/**
 * The environment for an agent. When the factory itself runs inside a Claude
 * Code session, that session's variables would make the child think it is a
 * nested SDK session; strip them so every agent starts like a fresh `claude -p`
 * with the user's own login.
 */
export function agentEnv(): NodeJS.ProcessEnv {
  const keep = new Set(['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CONFIG_DIR']);
  const insideHost = !!process.env.CLAUDECODE;
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (keep.has(k)) env[k] = v;
    else if (k.startsWith('CLAUDE') || k.startsWith('MCP_')) continue;
    else if (insideHost && k === 'ANTHROPIC_BASE_URL') continue;
    else env[k] = v;
  }
  return env;
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
    // Fresh, unpolluted context: no MCP servers, no user hooks/plugins by default.
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
        outputTokens: null, numTurns: null, timedOut: false, canceled: false,
        stderrTail: 'claude CLI not found. Install Claude Code or set CLAUDE_BIN in .env.',
      }),
    };
  }

  const child = spawn(bin, buildArgs(spec), {
    cwd: spec.cwd,
    env: agentEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  let sessionId: string | null = null;
  let result: Record<string, unknown> | null = null;
  let stderrTail = '';
  let timedOut = false;
  let canceled = false;

  const timer = setTimeout(() => {
    timedOut = true;
    killTree(child.pid);
  }, spec.timeoutMs);

  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let msg: Record<string, any>;
    try {
      msg = JSON.parse(line);
    } catch {
      onEvent({ type: 'log', data: { text: truncate(line, 2000) } });
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

  child.stderr.on('data', (d: Buffer) => {
    const s = d.toString();
    stderrTail = (stderrTail + s).slice(-8000);
    for (const l of s.split('\n')) if (l.trim()) onEvent({ type: 'stderr', data: { text: truncate(l, 2000) } });
  });

  const done = new Promise<AgentResult>((resolve) => {
    const finish = (code: number | null) => {
      clearTimeout(timer);
      lines.close();
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
      canceled = true;
      killTree(child.pid);
    },
  };
}
