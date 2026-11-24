// Replays past factory steps with other models: every succeeded run of a kind is re-run, as it
// was, in a sandbox per replay (the initiative folder as it stood when the run started, a
// detached worktree at the commit it saw, its stored prompt pointed at both), with the role
// prompt, tools and environment production uses today. It reads the database, never writes it,
// and never touches a real worktree. The report compares each model's verdicts with the
// original run's, with itself across repeats, and with the other models.
//
//   pnpm --filter @factory/server replay --kind arbitrate --models fable,opus --repeats 2 --max 40
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { AppSettings, Initiative, Project, Run } from '@factory/shared';
import { startAgent, type AgentHandle } from './agents/claude.ts';
import { config } from './config.ts';
import { sql } from './db.ts';
import * as gitx from './git.ts';
import { projectAgentSpec } from './pipeline/engine.ts';
import { initiativeDir } from './pipeline/files.ts';
import * as repo from './repo.ts';
import {
  agreement,
  baseCheckoutCommit,
  baseCommitOf,
  crossAgreement,
  fieldOf,
  inputsOf,
  outputPathOf,
  REPLAYABLE_KINDS,
  replayOrder,
  repointPrompt,
  utf8Text,
  verdictWord,
  worktreePathsIn,
  type ReplayOutcome,
  type ReplaySlot,
} from './replay/prompt.ts';

const SANDBOXES = 'factory-eval-sandboxes';
const USAGE =
  `usage: pnpm --filter @factory/server replay --kind ${REPLAYABLE_KINDS.join('|')} --models fable,opus (--max n | --limit n) [--max-cost usd] [--repeats 2] [--effort high] [--cases id8,id8] [--concurrency 3] [--out dir] [--dry-run]\n` +
  '       pnpm --filter @factory/server replay --report --out dir [--max n]   (rewrites report.md from report.json, keeping the first n replays)\n' +
  '  --max or --limit is required unless --dry-run. --max-cost starts no more replays once their summed cost passes it.\n' +
  `  Sandboxes live in <out>/${SANDBOXES}; every run removes what a crashed run left there, so two replays running at once need different --out folders.`;

const { values: opts } = parseArgs({
  options: {
    kind: { type: 'string' },
    models: { type: 'string' },
    repeats: { type: 'string', default: '2' },
    effort: { type: 'string' },
    limit: { type: 'string' },
    cases: { type: 'string' },
    // run only the first n replays in run order: each case once with every model, then the next repeat
    max: { type: 'string' },
    'max-cost': { type: 'string' },
    report: { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '3' },
    out: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

interface Case {
  run: Run;
  init: Initiative;
  project: Project;
  original: string | null;
}

type Task = ReplaySlot<Case>;

interface SavedReport {
  kind: string;
  models: string[];
  repeats: number;
  cases: { id: string; runId: string; original: string | null }[];
  done: Done[];
}

interface Done extends ReplayOutcome {
  model: string;
  repeat: number;
  costUsd: number | null;
  seconds: number;
  output: string | null;
  error: string | null;
  /** Inputs the replay saw as they are now, because they changed after the run. */
  stale: string[];
}

const say = (line: string) => process.stdout.write(`${line}\n`);
const caseId = (run: Run) => run.id.slice(0, 8);
// A full checkout of a large repository takes minutes on a loaded machine; git's default 2-minute cap failed 3 of 80.
const WORKTREE_ADD_MS = 900_000;
const running = new Set<AgentHandle>();

/** The newest `plan/round-N/<name>` written before the cutoff: the plan as it stood then. */
function planAsOf(initDir: string, name: string, cutoffMs: number): string | null {
  const planDir = path.join(initDir, 'plan');
  const rounds = fs.existsSync(planDir) ? fs.readdirSync(planDir).filter((r) => /^round-\d+$/.test(r)) : [];
  return (
    rounds
      .map((r) => path.join(planDir, r, name))
      .filter((f) => fs.existsSync(f) && fs.statSync(f).mtimeMs <= cutoffMs)
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null
  );
}

/**
 * The initiative folder as it stood when the run started: files written later are left out,
 * except the run's own folder (written as it started) and the inputs its prompt names. The
 * initiative's plan.md / plan.json are rewritten every round, so they come from the round that
 * was current then. Any other named input written later is copied as it is now and returned, so
 * the report can say that case saw something from after the run.
 */
function copyAsOf(src: string, dst: string, cutoffMs: number, keep: string[], inputs: Set<string>, skip: string[]): string[] {
  const stale: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (skip.some((s) => p === s || p.startsWith(`${s}/`))) continue;
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      if (!e.isFile()) continue;
      const later = fs.statSync(p).mtimeMs > cutoffMs;
      const inKept = keep.some((k) => p.startsWith(`${k}/`));
      if (later && !inKept && !inputs.has(p)) continue;
      let from = p;
      if (later && !inKept) {
        const isPlan = path.dirname(p) === src && (e.name === 'plan.md' || e.name === 'plan.json');
        const then = isPlan ? planAsOf(src, e.name, cutoffMs) : null;
        if (then) from = then;
        else stale.push(path.relative(src, p));
      }
      const to = path.join(dst, path.relative(src, p));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  };
  walk(src);
  return stale;
}

async function must(p: Promise<gitx.ExecResult>, what: string): Promise<string> {
  const r = await p;
  if (r.code !== 0) throw new Error(`${what} failed: ${(r.stderr || r.stdout).trim().slice(0, 400)}`);
  return r.stdout.trim();
}

/**
 * A private bare repository for one case, shared by its replays (each adds its own worktrees):
 * the real repository's objects (shared, nothing is copied), its branches and remote-tracking
 * refs as they were when the run started (newer commits rewound away), and no remote, so
 * neither `git fetch` nor `gh` can show the agent how things turned out. A worktree of the real
 * repository would share today's refs.
 */
async function sandboxRepo(c: Case, caseDir: string): Promise<string> {
  const dir = path.join(caseDir, 'repo.git');
  fs.mkdirSync(caseDir, { recursive: true });
  const common = await must(gitx.git(c.project.repoPath, ['rev-parse', '--path-format=absolute', '--git-common-dir']), 'finding the repository');
  await must(gitx.git(caseDir, ['init', '--quiet', '--bare', dir]), 'git init');
  fs.writeFileSync(path.join(dir, 'objects', 'info', 'alternates'), `${path.join(common, 'objects')}\n`);
  await must(
    gitx.git(dir, ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', common, '+refs/heads/*:refs/heads/*', '+refs/remotes/*:refs/remotes/*'], 600_000),
    'copying refs',
  );
  const cutoff = Math.floor(new Date(c.run.startedAt!).getTime() / 1000);
  const refs = (await must(gitx.git(dir, ['for-each-ref', '--format=%(refname) %(committerdate:unix)']), 'listing refs')).split('\n').filter(Boolean);
  const updates: string[] = [];
  for (const line of refs) {
    const [ref, at] = line.split(' ');
    if (Number(at) <= cutoff) continue;
    const then = (await gitx.git(dir, ['rev-list', '-1', `--before=${cutoff}`, ref])).stdout.trim();
    updates.push(then ? `update ${ref} ${then}` : `delete ${ref}`);
  }
  if (updates.length) execFileSync('git', ['-C', dir, 'update-ref', '--stdin'], { input: `${updates.join('\n')}\n` });
  return dir;
}

/** One rewound repository per case, built when its first replay starts and removed after its last. */
function caseRepos(tasks: Task[], root: string) {
  const repos = new Map<Case, { dir: string; left: number; ready?: Promise<string> }>();
  for (const t of tasks) {
    const r = repos.get(t.c) ?? { dir: path.join(root, caseId(t.c.run)), left: 0 };
    r.left++;
    repos.set(t.c, r);
  }
  return {
    dirOf: (c: Case) => repos.get(c)!.dir,
    repoOf(c: Case): Promise<string> {
      const r = repos.get(c)!;
      r.ready ??= sandboxRepo(c, r.dir);
      return r.ready;
    },
    release(c: Case): void {
      const r = repos.get(c)!;
      if (--r.left === 0) fs.rmSync(r.dir, { recursive: true, force: true });
    },
  };
}

type CaseRepos = ReturnType<typeof caseRepos>;

function textFilesUnder(dir: string): [file: string, text: string][] {
  const out: [string, string][] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        const text = utf8Text(fs.readFileSync(p));
        if (text != null) out.push([p, text]);
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

/** What a named worktree held when the run started: a base checkout's commit, or its ticket's branch as of then. */
async function revForWorktree(worktree: string, repoDir: string): Promise<string | null> {
  const base = baseCheckoutCommit(worktree);
  const [ticket] = base ? [] : await sql<{ branch: string | null }[]>`select branch from tickets where worktree_path = ${worktree} limit 1`;
  for (const rev of [base, ticket?.branch && `refs/heads/${ticket.branch}`, ticket?.branch && `refs/remotes/origin/${ticket.branch}`]) {
    if (!rev) continue;
    const found = await gitx.git(repoDir, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
    if (found.code === 0) return found.stdout.trim();
  }
  return null;
}

/** The commit the run saw: its head, else its base commit, else its base branch as it stood then. */
async function commitFor(c: Case, repoDir: string): Promise<string> {
  const candidates = [c.run.headSha, baseCommitOf(c.run.prompt!), c.run.baseSha, `refs/remotes/origin/${c.init.baseBranch}`].filter((s): s is string => !!s);
  for (const rev of candidates) {
    const found = await gitx.git(repoDir, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
    if (found.code === 0) return found.stdout.trim();
  }
  throw new Error(`none of the run's commits (${candidates.join(', ')}) exist in ${c.project.repoPath}`);
}

async function replay(t: Task, repos: CaseRepos, out: string, app: AppSettings): Promise<Done> {
  const { run, init, project } = t.c;
  const id = caseId(run);
  const box = path.join(repos.dirOf(t.c), `${t.model}-${t.repeat}`);
  const started = Date.now();
  const base: Omit<Done, 'verdict' | 'costUsd' | 'output' | 'error' | 'seconds' | 'stale'> = { caseId: id, arm: t.model, model: t.model, repeat: t.repeat };
  let stale: string[] = [];
  const wt = path.join(box, 'wt');
  try {
    const realInit = initiativeDir(init);
    const boxInit = path.join(box, 'init');
    // The linked PRs' checkouts hold their state as of now, which can't be wound back: left out.
    const checkouts = path.join(realInit, 'links', 'checkouts');
    stale = copyAsOf(realInit, boxInit, new Date(run.startedAt!).getTime(), run.runDir ? [run.runDir] : [], new Set(inputsOf(run.prompt!)), [checkouts]);
    const repoDir = await repos.repoOf(t.c);
    const baseCommit = await commitFor(t.c, repoDir);
    await must(gitx.git(repoDir, ['worktree', 'add', '--quiet', '--detach', wt, baseCommit], WORKTREE_ADD_MS), 'git worktree add');
    // The main checkout and every worktree the prompt or its inputs name (other tickets, base
    // checkouts) show today's code: each becomes a sandbox worktree as of the run's start.
    const moves: [string, string][] = [[realInit, boxInit], [project.repoPath, wt]];
    if (run.cwd) moves.push([run.cwd, wt]);
    const copied = textFilesUnder(boxInit);
    const named = new Set([run.prompt!, ...copied.map(([, text]) => text)].flatMap((text) => worktreePathsIn(text, config.home)));
    let n = 0;
    for (const real of named) {
      if (real === run.cwd) continue;
      const rev = (await revForWorktree(real, repoDir)) ?? baseCommit;
      const mirror = path.join(box, 'wts', String(n++));
      await must(gitx.git(repoDir, ['worktree', 'add', '--quiet', '--detach', mirror, rev], WORKTREE_ADD_MS), 'git worktree add');
      moves.push([real, mirror]);
    }
    for (const [f, text] of copied) {
      const moved = repointPrompt(text, moves);
      if (moved !== text) fs.writeFileSync(f, moved);
    }
    const prompt = repointPrompt(run.prompt!, moves);
    const output = outputPathOf(prompt);
    if (!output || !output.startsWith(box)) throw new Error(`the output ${output ?? '(none)'} is not inside the sandbox`);
    fs.rmSync(output, { force: true });
    const branch = fieldOf(run.prompt!, 'Branch');
    // GitHub shows how things turned out (later commits, CI, merges), so the replay gets none
    // of it: a logged-out gh, no git credentials, no ssh. The original run read GitHub as it
    // was then; that state is gone, and both models now work from the same past.
    const offline = path.join(box, 'offline');
    fs.mkdirSync(path.join(offline, 'gh'), { recursive: true });
    fs.writeFileSync(path.join(offline, 'gitconfig'), '');
    const noGithub = {
      GH_CONFIG_DIR: path.join(offline, 'gh'),
      GH_TOKEN: '',
      GITHUB_TOKEN: '',
      GH_ENTERPRISE_TOKEN: '',
      GIT_CONFIG_GLOBAL: path.join(offline, 'gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_SSH_COMMAND: 'false',
    };
    const spec = projectAgentSpec(project, app, {
      kind: run.kind as Parameters<typeof projectAgentSpec>[2]['kind'],
      cwd: wt,
      prompt: '',
      model: t.model,
      effort: opts.effort ?? run.effort,
      addDirs: [path.dirname(output), boxInit],
      env: { ...(run.baseSha ? { FACTORY_BASE: run.baseSha } : {}), ...(branch ? { FACTORY_BRANCH: branch } : {}), ...noGithub },
      projectRules: await repo.acceptedProjectRules(project.id),
    });
    spec.prompt = prompt;
    const handle = startAgent(spec, () => {});
    running.add(handle);
    const result = await handle.done.finally(() => running.delete(handle));
    const written = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : null;
    const first = written?.split('\n')[0] ?? null;
    let kept: string | null = null;
    if (written) {
      kept = path.join(out, 'outputs', id, `${t.model}-${t.repeat}.md`);
      fs.mkdirSync(path.dirname(kept), { recursive: true });
      fs.writeFileSync(kept, written);
    }
    return {
      ...base,
      verdict: verdictWord(first),
      costUsd: result.costUsd,
      seconds: Math.round((Date.now() - started) / 1000),
      output: kept,
      error: written ? null : `no ${path.basename(output)} (${result.timedOut ? 'timed out' : result.subtype ?? `exit ${result.exitCode}`})`,
      stale,
    };
  } catch (err) {
    return { ...base, verdict: null, costUsd: null, seconds: Math.round((Date.now() - started) / 1000), output: null, error: (err as Error).message, stale };
  } finally {
    fs.rmSync(box, { recursive: true, force: true });
    repos.release(t.c);
  }
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function render(kind: string, models: string[], cases: Pick<Case, 'run' | 'original'>[], done: Done[]): string {
  const original = new Map(cases.map((c) => [caseId(c.run), c.original]));
  const lines = [
    `# Replay of ${cases.length} past ${kind} run(s) with ${models.join(', ')}`,
    '',
    'Each replay is the original step re-run in a sandbox: the initiative folder as it stood when the run started, a worktree at the commit it saw, and its stored prompt. "Original" is what production decided then.',
    '',
    '| Model | Replays | Failed | Same as original | Consistent across repeats | Cost | Avg cost | Avg time |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const a of agreement(original, done)) {
    const mine = done.filter((d) => d.arm === a.arm);
    const cost = mine.reduce((s, d) => s + (d.costUsd ?? 0), 0);
    const finished = mine.filter((d) => d.costUsd != null);
    const secs = mine.reduce((s, d) => s + d.seconds, 0) / (mine.length || 1);
    lines.push(`| ${a.arm} | ${a.replays} | ${a.failed} | ${pct(a.withOriginal)} | ${a.selfConsistent == null ? '—' : pct(a.selfConsistent)} | $${cost.toFixed(2)} | $${(cost / (finished.length || 1)).toFixed(2)} | ${Math.round(secs)} s |`);
  }
  for (let i = 0; i < models.length; i++) {
    for (let j = i + 1; j < models.length; j++) {
      const x = crossAgreement(done, models[i], models[j]);
      lines.push('', `${models[i]} and ${models[j]} reach the same verdict on ${pct(x.agree)} of ${x.cases} cases${x.differ.length ? `; they differ on ${x.differ.join(', ')}` : ''}.`);
    }
  }
  lines.push('', '## Cases', '', `| Case | Run | Original | ${models.join(' | ')} | Inputs from after the run |`, `|---|---|---|${models.map(() => '---').join('|')}|---|`);
  for (const c of cases) {
    const id = caseId(c.run);
    const cells = models.map((m) =>
      done
        .filter((d) => d.caseId === id && d.arm === m)
        .sort((a, b) => a.repeat - b.repeat)
        .map((d) => d.verdict ?? 'failed')
        .join(', '),
    );
    const what = (c.run.prompt!.split('\n')[0] ?? '').replace(/^Factory step: [\w-]+\.\s*/, '').slice(0, 90);
    const stale = [...new Set(done.filter((d) => d.caseId === id).flatMap((d) => d.stale))];
    lines.push(`| ${id} | ${what} | ${c.original ?? '?'} | ${cells.join(' | ')} | ${stale.join(', ') || '—'} |`);
  }
  const failed = done.filter((d) => d.error);
  if (failed.length) lines.push('', '## Failed replays', '', ...failed.map((d) => `- ${d.caseId} ${d.model} #${d.repeat}: ${d.error}`));
  lines.push('', 'Every replay output is under `outputs/<case>/<model>-<repeat>.md`.');
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  if (opts.report) return rerender();
  const kind = opts.kind;
  const models = (opts.models ?? '').split(',').map((m) => m.trim()).filter(Boolean);
  if (!kind || !models.length) throw new Error(USAGE);
  if (!(REPLAYABLE_KINDS as readonly string[]).includes(kind)) throw new Error(`--kind ${kind} can't be replayed. Replayable kinds: ${REPLAYABLE_KINDS.join(', ')}`);
  const repeats = positiveFlag('repeats')!;
  const concurrency = positiveFlag('concurrency')!;
  const limit = positiveFlag('limit');
  const max = positiveFlag('max');
  const maxCost = positiveFlag('max-cost', { integer: false });
  if (limit == null && max == null && !opts['dry-run']) throw new Error(`--max or --limit is required unless --dry-run.\n${USAGE}`);
  const wanted = opts.cases ? opts.cases.split(',').map((s) => s.trim()) : null;
  const runs = (await sql<Run[]>`
    select * from runs where kind = ${kind} and status = 'succeeded' and prompt is not null and verdict is not null and started_at is not null
    order by started_at`).filter((r) => !wanted || wanted.some((w) => r.id.startsWith(w)));
  const cases: Case[] = [];
  for (const run of runs) {
    if (cases.length === limit) break;
    if (!outputPathOf(run.prompt!)) continue;
    const init = await repo.getInitiative(run.initiativeId);
    const project = init ? await repo.getProject(init.projectId) : null;
    if (!init || !project || !fs.existsSync(initiativeDir(init))) continue;
    cases.push({ run, init, project, original: verdictWord(run.verdict) });
  }
  const all = replayOrder(cases, models, repeats);
  const tasks: Task[] = all.slice(0, max ?? undefined);
  const planned = cases.filter((c) => tasks.some((t) => t.c === c));
  const app = await repo.getAppSettings();
  const cap = app.maxBudgetUsdPerRun;
  say(`Replay ${kind}: ${cases.length} case(s) x ${models.length} model(s) x ${repeats} repeat(s) = ${all.length} replays${tasks.length < all.length ? `, running the first ${tasks.length}` : ''}, ${concurrency} at a time`);
  for (const c of planned) say(`  ${caseId(c.run)} ${c.original ?? '?'} · ${(c.run.prompt!.split('\n')[0] ?? '').slice(0, 100)}`);
  say(
    `${tasks.length} replay(s) planned. Worst case: ${cap == null ? 'unbounded, as no max budget per run is set in Settings' : `$${(tasks.length * cap).toFixed(2)} (${tasks.length} x $${cap.toFixed(2)} per run)`}` +
      `${maxCost == null ? '' : `; no replay starts once their cost passes $${maxCost.toFixed(2)}`}.`,
  );
  if (opts['dry-run']) return;

  const out = path.resolve(opts.out ?? path.join(config.home, 'evals', `${new Date().toISOString().replace(/[:.]/g, '-')}-replay-${kind}`));
  const sandboxes = path.join(out, SANDBOXES);
  fs.rmSync(sandboxes, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const repos = caseRepos(tasks, sandboxes);
  const done: Done[] = [];
  let spent = 0;
  const overBudget = () => maxCost != null && spent > maxCost;
  let next = 0;
  const worker = async () => {
    while (next < tasks.length && !stopping && !overBudget()) {
      const t = tasks[next++];
      const d = await replay(t, repos, out, app);
      done.push(d);
      spent += d.costUsd ?? 0;
      say(`[${done.length}/${tasks.length}] ${d.caseId} ${d.model} #${d.repeat}: ${d.verdict ?? `failed (${d.error})`}${d.costUsd != null ? ` $${d.costUsd.toFixed(2)}` : ''} ${d.seconds}s`);
      fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ kind, models, repeats, cases: cases.map((c) => ({ id: caseId(c.run), runId: c.run.id, original: c.original })), done }, null, 1));
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  } finally {
    fs.rmSync(sandboxes, { recursive: true, force: true });
  }
  if (overBudget() && next < tasks.length) say(`Stopped at $${spent.toFixed(2)}, past --max-cost $${maxCost!.toFixed(2)}: ${tasks.length - next} replay(s) never started.`);
  const report = render(kind, models, planned, done);
  fs.writeFileSync(path.join(out, 'report.md'), report);
  say(`\n${report}\nReport: ${path.join(out, 'report.md')}`);
}

function positiveFlag(name: 'repeats' | 'concurrency' | 'limit' | 'max' | 'max-cost', { integer = true } = {}): number | null {
  const raw = opts[name];
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!(n > 0) || (integer && !Number.isInteger(n))) throw new Error(`--${name} must be a positive ${integer ? 'whole number' : 'number'}, not "${raw}".\n${USAGE}`);
  return n;
}

/**
 * Rewrites report.md from report.json, keeping only the first --max replays in run order. Use it
 * after stopping a replay early: replays cut off mid-run, and any that finished past the cut, drop out.
 */
async function rerender(): Promise<void> {
  if (!opts.out) throw new Error(USAGE);
  const out = path.resolve(opts.out);
  const saved = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8')) as SavedReport;
  const runs = await sql<Run[]>`select * from runs where id in ${sql(saved.cases.map((c) => c.runId))}`;
  const byId = new Map(runs.map((r) => [r.id, r]));
  const cases = saved.cases.flatMap((c) => {
    const run = byId.get(c.runId);
    return run ? [{ run, original: c.original }] : [];
  });
  const slots = replayOrder(cases, saved.models, saved.repeats).slice(0, positiveFlag('max') ?? undefined);
  const key = (id: string, model: string, repeat: number) => `${id} ${model} ${repeat}`;
  const keep = new Set(slots.map((s) => key(caseId(s.c.run), s.model, s.repeat)));
  const done = saved.done.filter((d) => keep.has(key(d.caseId, d.model, d.repeat)));
  const missing = keep.size - done.length;
  const report = render(saved.kind, saved.models, cases.filter((c) => slots.some((s) => s.c === c)), done);
  fs.writeFileSync(path.join(out, 'report.md'), report);
  say(`${report}\nReport: ${path.join(out, 'report.md')} (${done.length} of ${saved.done.length} replays kept${missing ? `; ${missing} of the first ${keep.size} never ran` : ''})`);
}

// A stop cancels the agents in flight and starts no more replays; their sandboxes are removed.
let stopping = false;
const stop = () => {
  stopping = true;
  for (const h of running) h.cancel();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// Agents run in their own process group; none outlives the replay.
process.on('exit', () => {
  for (const h of running) {
    try {
      if (h.pid) process.kill(-h.pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
});

main()
  .catch((err) => {
    console.error((err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => sql.end({ timeout: 2 }));
