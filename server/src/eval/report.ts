import type { EvalCase } from './fixtures.ts';
import type { ForbiddenCommand, Grade, GradeStatus } from './grade.ts';
import type { PlannedTask } from './plan.ts';

export interface TaskResult {
  taskId: string;
  caseName: string;
  repeat: number;
  arm: string;
  defectKind: string | null;
  status: GradeStatus;
  verdict: string | null;
  reason: string;
  forbidden: ForbiddenCommand[];
  costUsd: number | null;
  durationMs: number;
}

export interface Rate {
  hits: number;
  total: number;
  rate: number | null;
}

export interface ArmReport {
  arm: string;
  label: string;
  tasks: number;
  costUsd: number;
  meanCostUsd: number | null;
  meanDurationSec: number | null;
  forbiddenCommands: number;
  catchRates: Record<string, Rate> | null;
  falseAlarm: Rate | null;
}

export interface Paired {
  pairs: number;
  hitsA: number;
  hitsB: number;
  onlyA: number;
  onlyB: number;
  difference: number | null;
}

export interface Report {
  role: string;
  model: string;
  repeats: number;
  tasks: number;
  planned: number;
  arms: ArmReport[];
  blocked: { taskId: string; arm: string; reason: string }[];
  headlineWithheld: boolean;
  paired: { catch: Paired; falseAlarm: Paired } | null;
  saturated: string[] | null;
  flaky: { caseName: string; arm: string }[] | null;
  results: TaskResult[];
}

export function taskResult(task: PlannedTask, c: EvalCase, grade: Grade, costUsd: number | null, durationMs: number): TaskResult {
  return {
    taskId: task.id,
    caseName: task.caseName,
    repeat: task.repeat,
    arm: task.arm,
    defectKind: c.defectKind,
    status: grade.status,
    verdict: grade.verdict,
    reason: grade.reason,
    forbidden: grade.forbidden,
    costUsd,
    durationMs,
  };
}

const rateOf = (hits: number, total: number): Rate => ({ hits, total, rate: total ? hits / total : null });

const mean = (values: number[]): number | null => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

const isHit = (r: TaskResult): boolean => (r.defectKind ? r.status === 'pass' : r.status === 'fail');

function catchRates(results: TaskResult[]): Record<string, Rate> {
  const kinds = [...new Set(results.flatMap((r) => (r.defectKind ? [r.defectKind] : [])))];
  return Object.fromEntries(
    kinds.map((kind) => {
      const ofKind = results.filter((r) => r.defectKind === kind);
      return [kind, rateOf(ofKind.filter(isHit).length, ofKind.length)];
    }),
  );
}

function falseAlarm(results: TaskResult[]): Rate {
  const controls = results.filter((r) => !r.defectKind);
  return rateOf(controls.filter(isHit).length, controls.length);
}

function armReport(arm: { id: string; label: string }, results: TaskResult[], withheld: boolean): ArmReport {
  const costs = results.flatMap((r) => (r.costUsd == null ? [] : [r.costUsd]));
  return {
    arm: arm.id,
    label: arm.label,
    tasks: results.length,
    costUsd: costs.reduce((a, b) => a + b, 0),
    meanCostUsd: mean(costs),
    meanDurationSec: mean(results.map((r) => r.durationMs / 1000)),
    forbiddenCommands: results.reduce((n, r) => n + r.forbidden.length, 0),
    catchRates: withheld ? null : catchRates(results),
    falseAlarm: withheld ? null : falseAlarm(results),
  };
}

function paired(pairs: [TaskResult, TaskResult][]): Paired {
  const hitsA = pairs.filter(([a]) => isHit(a)).length;
  const hitsB = pairs.filter(([, b]) => isHit(b)).length;
  return {
    pairs: pairs.length,
    hitsA,
    hitsB,
    onlyA: pairs.filter(([a, b]) => isHit(a) && !isHit(b)).length,
    onlyB: pairs.filter(([a, b]) => !isHit(a) && isHit(b)).length,
    difference: pairs.length ? (hitsB - hitsA) / pairs.length : null,
  };
}

function completePairs(results: TaskResult[], armA: string, armB: string): [TaskResult, TaskResult][] {
  const graded = results.filter((r) => r.status !== 'blocked');
  const pairs: [TaskResult, TaskResult][] = [];
  for (const a of graded.filter((r) => r.arm === armA)) {
    const b = graded.find((r) => r.arm === armB && r.caseName === a.caseName && r.repeat === a.repeat);
    if (b) pairs.push([a, b]);
  }
  return pairs;
}

function saturatedCases(graded: TaskResult[]): string[] {
  const names = [...new Set(graded.map((r) => r.caseName))];
  return names.filter((name) => graded.filter((r) => r.caseName === name).every((r) => r.status === 'pass'));
}

function flakyCases(graded: TaskResult[]): { caseName: string; arm: string }[] {
  const keys = [...new Set(graded.map((r) => `${r.caseName}\u0000${r.arm}`))];
  return keys
    .map((key) => {
      const [caseName, arm] = key.split('\u0000');
      return { caseName, arm, statuses: new Set(graded.filter((r) => r.caseName === caseName && r.arm === arm).map((r) => r.status)) };
    })
    .filter((k) => k.statuses.size > 1)
    .map(({ caseName, arm }) => ({ caseName, arm }));
}

export function buildReport(input: { role: string; model: string; repeats: number; planned: number; arms: { id: string; label: string }[]; results: TaskResult[] }): Report {
  const { results } = input;
  const blocked = results.filter((r) => r.status === 'blocked').map((r) => ({ taskId: r.taskId, arm: r.arm, reason: r.reason }));
  const withheld = blocked.length > 0 || results.length < input.planned;
  const graded = results.filter((r) => r.status !== 'blocked');
  const [armA, armB] = input.arms;
  const pairs = !withheld && armB ? completePairs(results, armA.id, armB.id) : null;
  return {
    role: input.role,
    model: input.model,
    repeats: input.repeats,
    tasks: results.length,
    planned: input.planned,
    arms: input.arms.map((arm) => armReport(arm, results.filter((r) => r.arm === arm.id), withheld)),
    blocked,
    headlineWithheld: withheld,
    paired: pairs && {
      catch: paired(pairs.filter(([a]) => a.defectKind)),
      falseAlarm: paired(pairs.filter(([a]) => !a.defectKind)),
    },
    saturated: withheld ? null : saturatedCases(graded),
    flaky: withheld ? null : flakyCases(graded),
    results,
  };
}

const percent = (r: Rate | null | undefined): string => (r?.rate == null ? 'n/a' : `${r.hits}/${r.total} (${Math.round(r.rate * 100)}%)`);

const money = (usd: number | null): string => (usd == null ? 'n/a' : `$${usd.toFixed(2)}`);

const table = (head: string[], rows: string[][]): string[] => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)];

const signed = (diff: number | null): string => (diff == null ? 'n/a' : `${diff > 0 ? '+' : ''}${Math.round(diff * 100)} points`);

function renderPaired(label: string, p: Paired): string {
  return `- ${label}: ${p.pairs} pairs, arm A ${p.hitsA}, arm B ${p.hitsB}, only A ${p.onlyA}, only B ${p.onlyB}, B minus A ${signed(p.difference)}`;
}

export function renderMarkdown(report: Report): string {
  const lines = [
    `# Judge evaluation: ${report.role}`,
    '',
    `Model ${report.model}, ${report.repeats} repeats, ${report.tasks} of ${report.planned} planned tasks ran.`,
    '',
    ...report.arms.map((a) => `- Arm ${a.arm}: ${a.label}`),
    '',
  ];
  if (report.headlineWithheld) {
    const missing = report.planned - report.tasks;
    lines.push(
      `## Headline withheld: ${[report.blocked.length ? `${report.blocked.length} blocked tasks` : '', missing > 0 ? `${missing} missing tasks` : ''].filter(Boolean).join(', ')}`,
      '',
      'A blocked or missing task has no verdict to grade, so catch and false-alarm rates would be wrong. Fix the cause and run again.',
      '',
      ...report.blocked.map((b) => `- ${b.taskId} (arm ${b.arm}): ${b.reason}`),
      '',
    );
  } else {
    const kinds = [...new Set(report.arms.flatMap((a) => Object.keys(a.catchRates ?? {})))];
    lines.push(
      '## Catch rate by defect kind',
      '',
      ...table(['Defect kind', ...report.arms.map((a) => `Arm ${a.arm}`)], kinds.map((k) => [k, ...report.arms.map((a) => percent(a.catchRates?.[k]))])),
      '',
      '## False alarms on the clean controls',
      '',
      ...table(['', ...report.arms.map((a) => `Arm ${a.arm}`)], [['False-alarm rate', ...report.arms.map((a) => percent(a.falseAlarm))]]),
      '',
    );
    if (report.paired) {
      lines.push('## Paired difference (pairs where both arms have a graded result)', '', renderPaired('Catch', report.paired.catch), renderPaired('False alarm', report.paired.falseAlarm), '');
    }
    lines.push(
      '## Cases that cannot discriminate',
      '',
      `- Saturated (every repeat of every arm passed): ${report.saturated!.join(', ') || 'none'}`,
      `- Flaky (repeats of the same arm disagree): ${report.flaky!.map((f) => `${f.caseName} (arm ${f.arm})`).join(', ') || 'none'}`,
      '',
    );
  }
  lines.push(
    '## Cost and duration',
    '',
    ...table(
      ['Arm', 'Tasks', 'Total cost', 'Mean cost', 'Mean minutes', 'Forbidden commands'],
      report.arms.map((a) => [a.arm, String(a.tasks), money(a.costUsd), money(a.meanCostUsd), a.meanDurationSec == null ? 'n/a' : (a.meanDurationSec / 60).toFixed(1), String(a.forbiddenCommands)]),
    ),
  );
  return `${lines.join('\n')}\n`;
}

export function renderJson(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
