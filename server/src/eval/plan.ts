import type { EvalCase, EvalRole } from './fixtures.ts';

export const DEFAULT_REPEATS = 2;

/** One configuration under test. A null model or effort is the run's own (`--model`, the role's effort). */
export interface Arm {
  id: string;
  roleFile: string | null;
  model: string | null;
  effort: string | null;
}

export interface ArmOptions {
  roleFile: string | null;
  model?: string | null;
  effort?: string | null;
  compare?: string | null;
  compareModel?: string | null;
  compareEffort?: string | null;
}

export interface PlannedTask {
  id: string;
  caseName: string;
  repeat: number;
  arm: string;
}

export function selectCases(role: EvalRole, requested: string[], available: EvalCase[]): EvalCase[] {
  const ofRole = available.filter((c) => c.role === role);
  if (!requested.length) return ofRole;
  const unknown = requested.filter((name) => !ofRole.some((c) => c.name === name));
  if (unknown.length) throw new Error(`unknown ${role} cases: ${unknown.join(', ')}; available: ${ofRole.map((c) => c.name).join(', ')}`);
  return ofRole.filter((c) => requested.includes(c.name));
}

export function parseRepeats(value: string | undefined): number {
  if (value === undefined) return DEFAULT_REPEATS;
  const repeats = Number(value);
  if (!Number.isInteger(repeats) || repeats < 1) throw new Error(`--repeats must be a whole number of at least 1, got ${value}`);
  return repeats;
}

/**
 * Arm A is the configuration as given; arm B exists when anything is compared, and differs from A
 * only in what is compared: another role file, another model or another effort.
 */
export function planArms(o: ArmOptions): Arm[] {
  const a: Arm = { id: 'A', roleFile: o.roleFile, model: o.model ?? null, effort: o.effort ?? null };
  if (!o.compare && !o.compareModel && !o.compareEffort) return [a];
  return [a, { id: 'B', roleFile: o.compare ?? a.roleFile, model: o.compareModel ?? a.model, effort: o.compareEffort ?? a.effort }];
}

export function planCohort(caseNames: string[], armIds: string[], repeats: number): PlannedTask[] {
  const tasks: PlannedTask[] = [];
  for (let repeat = 1; repeat <= repeats; repeat++) {
    const order = repeat % 2 === 1 ? armIds : [...armIds].reverse();
    for (const caseName of caseNames) {
      for (const arm of order) tasks.push({ id: `${caseName}.r${repeat}.${arm}`, caseName, repeat, arm });
    }
  }
  return tasks;
}
