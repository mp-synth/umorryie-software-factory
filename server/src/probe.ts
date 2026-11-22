import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { agentEnvironment } from './agent-env.ts';
import { startAgent, type AgentEvent } from './agents/claude.ts';
import { config } from './config.ts';
import { sql } from './db.ts';
import * as gitx from './git.ts';
import { projectAgentSpec } from './pipeline/engine.ts';
import { slugify } from './pipeline/plan.ts';
import * as repo from './repo.ts';
import { loadLoginShellPath, repoShellEnv } from './shell-env.ts';

const USAGE =
  'usage: pnpm --filter @factory/server probe <project name> [--prompt "..."|--prompt-file f.md] [--model sonnet] [--diff-from <ref>] [--skip-setup] [--skip-checks] [--keep]';

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    prompt: { type: 'string' },
    'prompt-file': { type: 'string' },
    model: { type: 'string', default: 'sonnet' },
    'diff-from': { type: 'string' },
    'skip-setup': { type: 'boolean', default: false },
    'skip-checks': { type: 'boolean', default: false },
    keep: { type: 'boolean', default: false },
  },
});

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

function tail(text: string, lines: number): string {
  return text.trim().split('\n').slice(-lines).join('\n');
}

async function shellStep(label: string, command: string | null, cwd: string, env: NodeJS.ProcessEnv, redact: (t: string) => string): Promise<boolean> {
  if (!command?.trim()) {
    say(`· ${label}: none configured`);
    return true;
  }
  say(`· ${label}: $ ${command}`);
  const started = Date.now();
  const r = await gitx.runInNonLoginShell(command, { cwd, env, timeoutMs: 30 * 60_000, maxOutput: 200_000 });
  const seconds = Math.round((Date.now() - started) / 1000);
  say(`  exit ${r.code}${r.timedOut ? ' (timed out)' : ''} after ${seconds}s`);
  say(redact(tail(r.stdout + r.stderr, r.code === 0 ? 6 : 40)).replace(/^/gm, '  | '));
  return r.code === 0;
}

function describe(e: AgentEvent): string | null {
  const d = e.data as Record<string, any>;
  if (e.type === 'tool_use') return `  → ${d.name} ${JSON.stringify(d.input).slice(0, 240)}`;
  if (e.type === 'tool_result') return `  ${d.isError ? '✗' : '←'} ${String(d.text ?? '').replace(/\s+/g, ' ').slice(0, 240)}`;
  if (e.type === 'text') return `  ✎ ${String(d.text).replace(/\s+/g, ' ').slice(0, 300)}`;
  return null;
}

async function main(): Promise<void> {
  const name = positionals[0];
  const prompt = opts['prompt-file'] ? fs.readFileSync(opts['prompt-file'], 'utf8') : opts.prompt;
  if (!name) throw new Error(USAGE);
  const project = (await repo.listProjects()).find((p) => p.name === name);
  if (!project) throw new Error(`no project named ${name}`);
  const app = await repo.getAppSettings();
  say(`· login shell PATH ${(await loadLoginShellPath()) ? 'loaded' : 'not found, using the server PATH'}`);
  const base = await gitx.resolveBaseRef(project.repoPath, project.defaultBranch);
  const worktree = path.join(config.home, 'probes', `${slugify(project.name)}-${Date.now()}`);
  say(`Probe ${project.name}: worktree ${worktree} at ${base}`);
  fs.mkdirSync(path.dirname(worktree), { recursive: true });
  const added = await gitx.git(project.repoPath, ['worktree', 'add', '--detach', worktree, base]);
  if (added.code !== 0) throw new Error(added.stderr);

  try {
    const included = await gitx.copyWorktreeIncludes(project.repoPath, worktree);
    const local = await gitx.copyLocalFiles(project.repoPath, worktree, project.copyFiles);
    say(`· copied: ${[...included, ...local.copied].join(', ') || 'nothing'}${local.skipped.length ? ` · not copied: ${local.skipped.join(', ')}` : ''}`);
    const { redact } = agentEnvironment(project.repoPath, project.copyFiles);
    const diffBase = opts['diff-from'] ?? base;
    if (diffBase !== base) say(`· checks diff against ${diffBase}: ${(await gitx.diffStat(worktree, diffBase)).split('\n').at(-1)}`);
    const env = { ...repoShellEnv(), FACTORY_BASE: diffBase, FACTORY_BRANCH: '' };
    if (!opts['skip-setup'] && !(await shellStep('setup', project.setupCommand, worktree, env, redact))) return;
    if (!opts['skip-checks']) await shellStep('checks', project.checksCommand, worktree, env, redact);
    if (!prompt) return;

    const spec = projectAgentSpec(project, app, {
      kind: 'execute',
      cwd: worktree,
      prompt,
      model: opts.model!,
      addDirs: [],
      env: { FACTORY_BASE: base, FACTORY_BRANCH: '' },
    });
    say(`· agent (${spec.model}) tools ${spec.tools.join(',')}; reads ${spec.addDirs.join(', ') || 'no extra dirs'}; env ${Object.keys(spec.env ?? {}).length} vars`);
    const handle = startAgent(spec, (e) => {
      const line = describe(e);
      if (line) say(line);
    });
    const result = await handle.done;
    say(`· agent ${result.isError ? 'FAILED' : 'finished'} · $${result.costUsd?.toFixed(2) ?? '?'} · ${result.numTurns ?? '?'} turns`);
    say(result.resultText ?? result.stderrTail);
  } finally {
    if (opts.keep) say(`· kept ${worktree}`);
    else await gitx.removeWorktree(project.repoPath, worktree, null);
  }
}

main()
  .catch((err) => {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
