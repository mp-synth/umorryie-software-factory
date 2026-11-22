import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_APP_SETTINGS, DEFAULT_INITIATIVE_SETTINGS, type Project } from '@factory/shared';
import { startAgent, type AgentEvent, type AgentHandle } from './agents/claude.ts';
import { config } from './config.ts';
import { CASES, INITIATIVE_TITLE, OUTPUT_FILE, buildFixture, removeFixture, type EvalCase, type EvalRole, type Fixture } from './eval/fixtures.ts';
import { gradeTask } from './eval/grade.ts';
import { parseRepeats, planArms, planCohort, selectCases, type Arm, type PlannedTask } from './eval/plan.ts';
import { buildReport, renderJson, renderMarkdown, taskResult, type TaskResult } from './eval/report.ts';
import * as gitx from './git.ts';
import { projectAgentSpec } from './pipeline/engine.ts';
import { readIfExists } from './pipeline/files.ts';
import { ticketLabel } from './pipeline/labels.ts';
import { EFFORT, ROLE_FILES, header } from './pipeline/role-prompt.ts';
import { outputFailure } from './pipeline/verdict.ts';

const USAGE =
  'usage: pnpm --filter @factory/server eval --role review|verify [--model opus] [--repeats 2] [--role-file f.md] [--compare f.md] [--cases a,b] [--out dir] [--dry-run]';

const { values: opts } = parseArgs({
  options: {
    role: { type: 'string' },
    model: { type: 'string' },
    repeats: { type: 'string' },
    'role-file': { type: 'string' },
    compare: { type: 'string' },
    cases: { type: 'string' },
    out: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const EVAL_TIMEOUT_MINUTES = 20;

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

function parseRole(value: string | undefined): EvalRole {
  if (value !== 'review' && value !== 'verify') throw new Error(USAGE);
  return value;
}

function existingFile(value: string | undefined): string | null {
  if (!value) return null;
  const file = path.resolve(process.cwd(), value);
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error(`no such role file: ${file}`);
  return file;
}

const armLabel = (role: EvalRole, arm: Arm): string => arm.roleFile ?? `agents/${ROLE_FILES[role]}`;

function taskPrompt(role: EvalRole, f: Fixture): string {
  const title = `Factory step: ${role}. Ticket: ${ticketLabel(f.ticket)} (key ${f.ticket.key})`;
  const common: [string, string][] = [
    ['Initiative', INITIATIVE_TITLE],
    ['Worktree (read-only)', f.worktree],
    ['Branch', f.branch],
    ['Base', f.base],
  ];
  const reply = `Reply with one line: the first line of ${OUTPUT_FILE[role]}.`;
  if (role === 'review') {
    return header(title, [...common, ['Diff', `git diff ${f.base}...HEAD`], ['Round', '1']], f.inputs, [f.output], reply);
  }
  return header(
    title,
    [...common, ['Fix commits', `git log --oneline ${f.start}..HEAD`], ['Fix diff', `git diff ${f.start}..HEAD`], ['The branch before the fix', `git diff ${f.base}...${f.start}`]],
    f.inputs,
    [f.output],
    reply,
  );
}

const evalProject = (f: Fixture): Project => ({
  id: 'eval-project',
  name: 'tally',
  repoPath: f.worktree,
  defaultBranch: f.base,
  checksCommand: null,
  setupCommand: null,
  notes: null,
  remoteUrl: null,
  copyFiles: [],
  referenceDirs: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

async function describeFixture(c: EvalCase): Promise<void> {
  const f = await buildFixture(c.name);
  try {
    const changed = (range: string) => gitx.git(f.worktree, ['diff', '--name-only', range]).then((r) => r.stdout.trim().split('\n').join(', '));
    say(`- ${c.name}: expect ${c.expected}, ${c.defectKind ? `${c.defectKind} in ${c.defectFile}` : 'clean control'}`);
    say(`    branch ${f.branch} from ${f.base} changes ${await changed(`${f.base}...HEAD`)}`);
    if (f.start) say(`    fix commits change ${await changed(`${f.start}..HEAD`)}`);
    say(`    inputs ${f.inputs.map((i) => path.basename(i)).join(', ')}; output ${path.basename(f.output)}`);
  } finally {
    removeFixture(f);
  }
}

let current: AgentHandle | null = null;
let stopping = false;

async function runTask(role: EvalRole, model: string, task: PlannedTask, c: EvalCase, arm: Arm): Promise<{ result: TaskResult; output: string }> {
  const f = await buildFixture(c.name);
  try {
    const spec = projectAgentSpec(evalProject(f), { ...DEFAULT_APP_SETTINGS, runTimeoutMinutes: EVAL_TIMEOUT_MINUTES }, {
      kind: role,
      cwd: f.worktree,
      prompt: taskPrompt(role, f),
      model,
      effort: EFFORT[role],
      roleFile: arm.roleFile ?? undefined,
      addDirs: [f.runDir],
      env: { FACTORY_BASE: f.base, FACTORY_BRANCH: f.branch },
    });
    const events: AgentEvent[] = [];
    const started = Date.now();
    current = startAgent(spec, (e) => {
      if (e.type === 'tool_use') events.push(e);
    });
    const agent = await current.done;
    current = null;
    const output = readIfExists(f.output);
    const error = agent.timedOut ? 'timed out' : agent.canceled ? 'canceled' : outputFailure(agent, output, OUTPUT_FILE[role]);
    const grade = gradeTask(c, { output, error, events });
    return { result: taskResult(task, c, grade, agent.costUsd, Date.now() - started), output: output ?? `no output: ${error}\n` };
  } finally {
    removeFixture(f);
  }
}

async function main(): Promise<void> {
  const role = parseRole(opts.role);
  const model = opts.model ?? DEFAULT_INITIATIVE_SETTINGS.models[role];
  const repeats = parseRepeats(opts.repeats);
  const arms = planArms(existingFile(opts['role-file']), existingFile(opts.compare));
  const cases = selectCases(role, opts.cases ? opts.cases.split(',').map((n) => n.trim()).filter(Boolean) : [], CASES);
  const tasks = planCohort(cases.map((c) => c.name), arms.map((a) => a.id), repeats);
  say(`Eval ${role} with ${model}: ${cases.length} cases x ${repeats} repeats x ${arms.length} arm${arms.length > 1 ? 's' : ''} = ${tasks.length} tasks`);
  for (const arm of arms) say(`  arm ${arm.id}: ${armLabel(role, arm)}`);
  if (opts['dry-run']) {
    say('Fixtures (built in the temp directory and removed):');
    for (const c of cases) await describeFixture(c);
    say('Cohort order:');
    for (const t of tasks) say(`  ${t.id}`);
    say('Dry run: no agent was started and nothing was written.');
    return;
  }

  const out = path.resolve(opts.out ?? path.join(config.home, 'evals', new Date().toISOString().replace(/[:.]/g, '-')));
  fs.mkdirSync(path.join(out, 'tasks'), { recursive: true });
  process.once('SIGINT', () => {
    stopping = true;
    current?.cancel();
  });
  const results: TaskResult[] = [];
  let failure: unknown = null;
  try {
    for (const [n, task] of tasks.entries()) {
      if (stopping) break;
      const { result, output } = await runTask(role, model, task, cases.find((c) => c.name === task.caseName)!, arms.find((a) => a.id === task.arm)!);
      results.push(result);
      fs.writeFileSync(path.join(out, 'tasks', `${task.id}.md`), output);
      say(`[${n + 1}/${tasks.length}] ${task.id}: ${result.status} (${result.reason})${result.costUsd == null ? '' : ` $${result.costUsd.toFixed(2)}`}`);
    }
  } catch (err) {
    failure = err;
  }
  const report = buildReport({ role, model, repeats, planned: tasks.length, arms: arms.map((a) => ({ id: a.id, label: armLabel(role, a) })), results });
  fs.writeFileSync(path.join(out, 'report.md'), renderMarkdown(report));
  fs.writeFileSync(path.join(out, 'report.json'), renderJson(report));
  say('');
  say(renderMarkdown(report));
  say(`Written to ${out}`);
  if (failure) throw failure;
  if (report.headlineWithheld) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exitCode = 1;
});
