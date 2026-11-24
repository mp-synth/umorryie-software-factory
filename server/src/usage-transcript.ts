import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import type { UsageTokens } from '@factory/shared';

// What an agent session cost, read from the transcript Claude Code keeps for every
// session (~/.claude/projects/<cwd>/<session>.jsonl): one line per API response with
// the tokens it was billed for. Unlike the CLI's closing `total_cost_usd`, it is there
// for agents that were killed, timed out or crashed, and it splits out cache traffic.

interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

/** List prices are published per million tokens, with cache reads as a share of input that differs between model generations. */
function perMillion(input: number, output: number, cacheReadShare: number): Price {
  return { input, output, cacheRead: input * cacheReadShare };
}

/**
 * $ per million tokens on the Claude API (first-party list prices): input, output and
 * cache reads. Cache writes cost 1.25x input for the 5-minute cache, 2x for the 1-hour one.
 */
export const PRICES: Record<string, Price> = {
  'claude-fable-5-2': perMillion(8, 40, 0.025),
  'claude-opus-5-5': perMillion(4, 20, 0.05),
  'claude-sonnet-5-5': perMillion(2, 10, 0.05),
  'claude-haiku-5-5': perMillion(0.1, 0.5, 0.1),
  // Earlier models still in older transcripts (the factory pinned these before).
  'claude-fable-5-1': perMillion(10, 50, 0.025),
  'claude-fable-5': perMillion(10, 50, 0.1),
  'claude-opus-5': perMillion(5, 25, 0.1),
  'claude-opus-4-8': perMillion(5, 25, 0.1),
  'claude-opus-4-7': perMillion(5, 25, 0.1),
  'claude-opus-4-6': perMillion(5, 25, 0.1),
  'claude-sonnet-5': perMillion(2, 10, 0.1),
  'claude-sonnet-4-6': perMillion(3, 15, 0.1),
  'claude-haiku-4-5': perMillion(1, 5, 0.1),
};
// Haiku 5.5 prompts over 100K tokens are billed at a higher tier.
const HAIKU_LONG_PROMPT = perMillion(0.5, 2.5, 0.1);
const FAST_MODE_MULTIPLIER = 2;

/** The model a price is listed under: transcripts may carry a snapshot date (-20261103) or a context variant ([1m]). */
export function priceModelId(model: string): string {
  return model.replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');
}

export interface ApiUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  speed?: string;
}

function cacheWrites(u: ApiUsage): { fiveMinutes: number; oneHour: number } {
  if (!u.cache_creation) return { fiveMinutes: u.cache_creation_input_tokens ?? 0, oneHour: 0 };
  return { fiveMinutes: u.cache_creation.ephemeral_5m_input_tokens ?? 0, oneHour: u.cache_creation.ephemeral_1h_input_tokens ?? 0 };
}

/** Dollars for one API response, or null for a model without a known price. */
export function priceResponse(model: string, u: ApiUsage): number | null {
  const id = priceModelId(model);
  let price = PRICES[id];
  if (!price) return null;
  const prompt = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  if (id === 'claude-haiku-5-5' && prompt > 100_000) price = HAIKU_LONG_PROMPT;
  const m = (u.speed === 'fast' ? FAST_MODE_MULTIPLIER : 1) / 1e6;
  const writes = cacheWrites(u);
  return (
    ((u.input_tokens ?? 0) * price.input +
      writes.fiveMinutes * price.input * 1.25 +
      writes.oneHour * price.input * 2 +
      (u.cache_read_input_tokens ?? 0) * price.cacheRead +
      (u.output_tokens ?? 0) * price.output) *
    m
  );
}

export interface SessionUsage {
  sessionId: string;
  cwd: string | null;
  entrypoint: string | null;
  firstPrompt: string;
  startedAt: string;
  finishedAt: string;
  requests: number;
  tokens: UsageTokens;
  costUsd: number;
  /** The model that cost the most in this session. */
  model: string | null;
  /** Responses from models without a price; their tokens count, their dollars cannot. */
  unpriced: number;
}

export function claudeProjectsDir(): string {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
}

/** The folder Claude Code keeps a working directory's sessions in. */
export function projectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

export function findTranscript(sessionId: string, cwd: string | null, root = claudeProjectsDir()): string | null {
  const name = `${sessionId}.jsonl`;
  if (cwd) {
    const direct = path.join(root, projectDirName(cwd), name);
    if (fs.existsSync(direct)) return direct;
  }
  try {
    for (const dir of fs.readdirSync(root)) {
      const file = path.join(root, dir, name);
      if (fs.existsSync(file)) return file;
    }
  } catch {
    // no Claude Code projects folder
  }
  return null;
}

function jsonlFilesUnder(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return jsonlFilesUnder(p);
      return e.name.endsWith('.jsonl') ? [p] : [];
    });
  } catch {
    return [];
  }
}

function promptText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => (b && typeof b === 'object' && 'text' in b ? String(b.text) : '')).join(' ');
  return '';
}

/**
 * Sums every API response of a session: its own transcript plus the subagent transcripts
 * some Claude Code versions keep in a folder named after the session. One response can be
 * written over several lines; each is counted once.
 */
export async function readSessionUsage(file: string): Promise<SessionUsage | null> {
  const sessionId = path.basename(file, '.jsonl');
  const responses = new Map<string, { model: string; usage: ApiUsage; ts: string }>();
  let cwd: string | null = null;
  let entrypoint: string | null = null;
  let firstPrompt: string | null = null;
  for (const f of [file, ...jsonlFilesUnder(file.slice(0, -'.jsonl'.length))]) {
    const lines = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity });
    for await (const line of lines) {
      if (firstPrompt !== null && !line.includes('"assistant"')) continue;
      let l: Record<string, any>;
      try {
        l = JSON.parse(line);
      } catch {
        continue;
      }
      if (l.type === 'user' && firstPrompt === null && !l.isSidechain) firstPrompt = promptText(l.message?.content);
      if (l.type !== 'assistant' || !l.message?.usage || !l.timestamp) continue;
      cwd ??= l.cwd ?? null;
      entrypoint ??= l.entrypoint ?? null;
      const key = `${l.message.id}|${l.requestId ?? ''}`;
      const prev = responses.get(key);
      if (!prev || (l.message.usage.output_tokens ?? 0) >= (prev.usage.output_tokens ?? 0)) {
        const ts = String(l.timestamp);
        responses.set(key, { model: String(l.message.model), usage: l.message.usage, ts: prev && prev.ts < ts ? prev.ts : ts });
      }
    }
  }
  if (responses.size === 0) return null;
  const tokens: UsageTokens = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  const byModel = new Map<string, number>();
  let costUsd = 0;
  let unpriced = 0;
  let startedAt = '';
  let finishedAt = '';
  for (const { model, usage, ts } of responses.values()) {
    tokens.input += usage.input_tokens ?? 0;
    tokens.cacheWrite += usage.cache_creation_input_tokens ?? 0;
    tokens.cacheRead += usage.cache_read_input_tokens ?? 0;
    tokens.output += usage.output_tokens ?? 0;
    if (!startedAt || ts < startedAt) startedAt = ts;
    if (ts > finishedAt) finishedAt = ts;
    const price = priceResponse(model, usage);
    if (price === null) {
      if (model !== '<synthetic>') unpriced++;
      continue;
    }
    costUsd += price;
    const id = priceModelId(model);
    byModel.set(id, (byModel.get(id) ?? 0) + price);
  }
  const model = [...byModel.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { sessionId, cwd, entrypoint, firstPrompt: firstPrompt ?? '', startedAt, finishedAt, requests: responses.size, tokens, costUsd, model, unpriced };
}

/** How a session started, from its first lines only: enough to skip interactive sessions without reading them. */
export async function peekSession(file: string, maxLines = 200): Promise<Pick<SessionUsage, 'entrypoint' | 'firstPrompt'>> {
  const stream = fs.createReadStream(file);
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let entrypoint: string | null = null;
  let firstPrompt: string | null = null;
  let n = 0;
  try {
    for await (const line of lines) {
      if (++n > maxLines) break;
      let l: Record<string, any>;
      try {
        l = JSON.parse(line);
      } catch {
        continue;
      }
      entrypoint ??= typeof l.entrypoint === 'string' ? l.entrypoint : null;
      if (l.type === 'user' && firstPrompt === null && !l.isSidechain) firstPrompt = promptText(l.message?.content);
      if (entrypoint && firstPrompt !== null) break;
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return { entrypoint, firstPrompt: firstPrompt ?? '' };
}

/** The factory step a `claude -p` session ran, from its prompt; null for anything the factory did not start. */
export function factoryKindOf(s: Pick<SessionUsage, 'entrypoint' | 'firstPrompt'> & { cwd?: string | null }): string | null {
  if (s.entrypoint !== 'sdk-cli') return null;
  // `pnpm eval` builds its fixture repos in factory-eval-* temp folders: factory money, not initiative work.
  if (s.cwd?.includes('/factory-eval-') && /^Factory step: /.test(s.firstPrompt)) return 'eval';
  const step = s.firstPrompt.match(/^Factory step: ([\w-]+)/);
  if (step) return step[1].replace(/-/g, '_');
  if (/^Repository: .+\nDecide how the factory prepares/.test(s.firstPrompt)) return 'discovery';
  return null;
}

/** "Initiative · [02] Ticket" from the first line of a factory prompt. */
export function labelFromPrompt(prompt: string): string | null {
  const first = prompt.split('\n')[0] ?? '';
  const repo = first.match(/^Repository: (.+)/);
  if (repo) return path.basename(repo[1].trim());
  const label = first
    .replace(/^Factory step: [\w-]+\.\s*/, '')
    .replace(/\b(Initiative|Ticket): /g, '')
    .trim();
  return label ? label.slice(0, 200) : null;
}

/** Initiative folders and worktrees end in the first 8 hex digits of the initiative id. */
export function initiativeIdPrefix(cwd: string | null): string | null {
  return cwd?.match(/\/(?:worktrees\/[^/]+|initiatives)\/[^/]*-([0-9a-f]{8})(?:\/|$)/)?.[1] ?? null;
}
