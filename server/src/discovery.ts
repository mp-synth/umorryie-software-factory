import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { BrowseResult, DirEntry, EnvironmentSuggestion } from '@factory/shared';
import { startAgent } from './agents/claude.ts';
import { config } from './config.ts';
import * as gitx from './git.ts';
import { getAppSettings } from './repo.ts';

const PREFERRED_ENV_FILES = ['.env', '.env.local', '.env.development', '.env.development.local', '.env.test', '.env.test.local'];
const TEMPLATE_FILE = /\.(example|sample|template|dist|bak|backup|orig|old)$/i;
const REGISTRY_CONFIG_FILES = ['uv.toml', '.npmrc', '.yarnrc.yml', 'bunfig.toml', 'pip.conf', 'poetry.toml', '.pypirc'];
const FROZEN_INSTALL = {
  pnpm: 'pnpm install --frozen-lockfile',
  yarn: 'yarn install --frozen-lockfile',
  bun: 'bun install --frozen-lockfile',
  npm: 'npm ci',
} as const;
const STATIC_CHECK_SCRIPTS = ['format:check', 'lint', 'typecheck'];
const DISCOVERY_TIMEOUT_MS = 6 * 60_000;
const DISCOVERY_BUDGET_USD = 2;
const MAX_REFERENCE_DIRS = 5;

type PackageManager = keyof typeof FROZEN_INSTALL;
type Commands = Pick<EnvironmentSuggestion, 'setupCommand' | 'checksCommand' | 'evidence'>;

export function defaultBrowseRoot(): string {
  const workspace = path.join(os.homedir(), 'workspace');
  return fs.existsSync(workspace) ? workspace : os.homedir();
}

function isDirectory(full: string): boolean {
  try {
    return fs.statSync(full).isDirectory();
  } catch {
    return false;
  }
}

function isGitCheckout(dir: string): boolean {
  return fs.existsSync(path.join(dir, '.git'));
}

export function browse(dir: string): BrowseResult {
  const entries: DirEntry[] = fs
    .readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .map((name) => path.join(dir, name))
    .filter(isDirectory)
    .map((full) => ({ name: path.basename(full), path: full, git: isGitCheckout(full) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const parent = path.dirname(dir);
  return { path: dir, parent: parent === dir ? null : parent, home: os.homedir(), entries };
}

function siblingCheckouts(dir: string): DirEntry[] {
  return browse(path.dirname(dir)).entries.filter((e) => e.git && e.path !== dir);
}

function readPackageJson(dir: string): { packageManager?: string; scripts?: Record<string, string> } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

function nodePackageManager(dir: string, declared: string | undefined): PackageManager {
  const name = (declared ?? '').split('@')[0];
  if (name in FROZEN_INSTALL) return name as PackageManager;
  const has = (f: string) => fs.existsSync(path.join(dir, f));
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  return has('bun.lockb') || has('bun.lock') ? 'bun' : 'npm';
}

function nodeCommands(dir: string, pkg: NonNullable<ReturnType<typeof readPackageJson>>): Commands {
  const pm = nodePackageManager(dir, pkg.packageManager);
  const scripts = pkg.scripts ?? {};
  const present = STATIC_CHECK_SCRIPTS.filter((s) => scripts[s]);
  return {
    setupCommand: FROZEN_INSTALL[pm],
    checksCommand: present.length ? present.map((s) => `${pm} run ${s}`).join(' && ') : null,
    evidence: [`package.json: ${pm}, ${present.length ? `scripts ${present.join(', ')}` : 'no format, lint or typecheck script'}`],
  };
}

function usesRuff(dir: string): boolean {
  const has = (f: string) => fs.existsSync(path.join(dir, f));
  return has('ruff.toml') || has('.ruff.toml') || fs.readFileSync(path.join(dir, 'pyproject.toml'), 'utf8').includes('[tool.ruff');
}

function pythonCommands(dir: string): Commands {
  const has = (f: string) => fs.existsSync(path.join(dir, f));
  const runner = has('uv.lock') ? 'uv' : has('poetry.lock') ? 'poetry' : null;
  const setup = { uv: 'uv sync', poetry: 'poetry install --no-interaction' } as const;
  const ruff = usesRuff(dir);
  return {
    setupCommand: runner ? setup[runner] : null,
    checksCommand: ruff ? `${runner ? `${runner} run ` : ''}ruff check` : null,
    evidence: [`pyproject.toml${runner ? ` with ${runner}.lock` : ''}${ruff ? ', ruff configured' : ', no linter configured'}`],
  };
}

function fileBasedCommands(dir: string): Commands {
  const pkg = readPackageJson(dir);
  if (pkg) return nodeCommands(dir, pkg);
  const has = (f: string) => fs.existsSync(path.join(dir, f));
  if (has('pyproject.toml')) return pythonCommands(dir);
  if (has('Cargo.toml')) return { setupCommand: null, checksCommand: 'cargo check --quiet', evidence: ['Cargo.toml'] };
  if (has('go.mod')) return { setupCommand: 'go mod download', checksCommand: 'go vet ./...', evidence: ['go.mod'] };
  return { setupCommand: null, checksCommand: null, evidence: [] };
}

function isCopyCandidate(dir: string, name: string): boolean {
  const looksLocal = /^\.env(\.|$)/.test(name) || REGISTRY_CONFIG_FILES.includes(name);
  return looksLocal && !TEMPLATE_FILE.test(name) && fs.statSync(path.join(dir, name)).isFile();
}

export async function copyFileCandidates(dir: string): Promise<string[]> {
  return gitx.ignoredFiles(dir, fs.readdirSync(dir).filter((n) => isCopyCandidate(dir, n)));
}

export async function suggestFromFiles(dir: string): Promise<EnvironmentSuggestion> {
  const candidates = await copyFileCandidates(dir);
  return {
    source: 'files',
    ...fileBasedCommands(dir),
    copyFiles: candidates.filter((f) => PREFERRED_ENV_FILES.includes(f)),
    referenceDirs: [],
    prerequisites: [],
  };
}

const discoveryReply = z.object({
  setupCommand: z.string().nullable().catch(null),
  checksCommand: z.string().nullable().catch(null),
  copyFiles: z.array(z.string()).catch([]),
  referenceDirs: z.array(z.string()).catch([]),
  prerequisites: z.array(z.string()).catch([]),
  evidence: z.array(z.string()).catch([]),
});

export function parseDiscoveryReply(text: string): z.infer<typeof discoveryReply> {
  const fenced = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].at(-1)?.[1];
  const body = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return discoveryReply.parse(JSON.parse(body));
}

function blankToNull(s: string | null): string | null {
  return s?.trim() ? s.trim() : null;
}

function discoveryPrompt(dir: string, guess: EnvironmentSuggestion, candidates: string[], siblings: DirEntry[]): string {
  return [
    `Repository: ${dir}`,
    'Decide how the factory prepares and checks a fresh worktree of this repository, following your role.',
    `A guess from lockfiles and package scripts alone: setup \`${guess.setupCommand ?? 'none'}\`, checks \`${guess.checksCommand ?? 'none'}\`. Replace it with what the repo actually documents and configures.`,
    `copyFiles candidates (gitignored, at the repo root): ${candidates.length ? candidates.join(', ') : 'none'}`,
    `referenceDirs candidates (sibling checkouts in ${path.dirname(dir)}): ${siblings.length ? siblings.map((s) => s.name).join(', ') : 'none'}`,
  ].join('\n');
}

export function resolveDiscovery(
  reply: z.infer<typeof discoveryReply>,
  candidates: string[],
  siblings: DirEntry[],
): Omit<EnvironmentSuggestion, 'source' | 'costUsd'> {
  const siblingPath = new Map(siblings.map((s) => [s.name, s.path]));
  const referenceDirs = reply.referenceDirs.map((r) => siblingPath.get(path.basename(r))).filter((p): p is string => !!p);
  return {
    setupCommand: blankToNull(reply.setupCommand),
    checksCommand: blankToNull(reply.checksCommand),
    copyFiles: reply.copyFiles.filter((f) => candidates.includes(f)),
    referenceDirs: [...new Set(referenceDirs)].slice(0, MAX_REFERENCE_DIRS),
    prerequisites: reply.prerequisites,
    evidence: reply.evidence,
  };
}

async function runDiscovery(dir: string): Promise<EnvironmentSuggestion> {
  const [guess, candidates, app] = await Promise.all([suggestFromFiles(dir), copyFileCandidates(dir), getAppSettings()]);
  const siblings = siblingCheckouts(dir);
  const { done } = startAgent(
    {
      cwd: dir,
      model: 'sonnet',
      effort: 'medium',
      rolePrompt: fs.readFileSync(path.join(config.agentsDir, 'discoverer.md'), 'utf8'),
      prompt: discoveryPrompt(dir, guess, candidates, siblings),
      tools: ['Read', 'Grep', 'Glob'],
      addDirs: [],
      timeoutMs: DISCOVERY_TIMEOUT_MS,
      maxBudgetUsd: DISCOVERY_BUDGET_USD,
      loadUserSettings: app.loadUserSettings,
    },
    () => {},
  );
  const result = await done;
  if (!result.resultText) {
    throw new Error(`discovery agent ${result.timedOut ? 'timed out' : 'failed'}: ${result.subtype ?? ''} ${result.stderrTail.slice(-400)}`.trim());
  }
  return { source: 'claude', ...resolveDiscovery(parseDiscoveryReply(result.resultText), candidates, siblings), costUsd: result.costUsd };
}

const discoveries = new Map<string, Promise<EnvironmentSuggestion>>();

export async function discoverWithClaude(dir: string, force = false): Promise<EnvironmentSuggestion> {
  const key = `${dir}@${await gitx.headSha(dir)}`;
  if (force) discoveries.delete(key);
  const existing = discoveries.get(key);
  if (existing) return existing;
  const pending = runDiscovery(dir);
  discoveries.set(key, pending);
  pending.catch(() => discoveries.delete(key));
  return pending;
}
