import path from 'node:path';
import type { AgentEvent } from '../agents/claude.ts';
import { section } from '../pipeline/plan.ts';
import { malformedVerdictReason, parseVerdict } from '../pipeline/verdict.ts';
import type { EvalCase } from './fixtures.ts';

export type GradeStatus = 'pass' | 'fail' | 'blocked';

export interface ForbiddenCommand {
  kind: 'test-runner' | 'git-push' | 'commit';
  command: string;
}

export interface Grade {
  status: GradeStatus;
  verdict: string | null;
  reason: string;
  forbidden: ForbiddenCommand[];
}

const FORBIDDEN: [ForbiddenCommand['kind'], RegExp][] = [
  ['test-runner', /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|npx\s+\S*(?:jest|vitest|mocha)|jest|vitest|mocha|pytest|node\s+(?:\S+\s+)*--test|node\s+\S*\.test\.[cm]?[jt]s)\b/],
  ['git-push', /^git\s+(?:-[cC]\s+\S+\s+|-\S+\s+)*push\b/],
  ['commit', /^git\s+(?:-[cC]\s+\S+\s+|-\S+\s+)*commit\b/],
];

const segmentsOf = (command: string): string[] =>
  command
    .split(/&&|\|\||[;|\n]/)
    .map((s) => s.trim().replace(/^(?:\w+=\S+\s+)+/, ''))
    .filter(Boolean);

export function forbiddenCommands(events: Pick<AgentEvent, 'type' | 'data'>[]): ForbiddenCommand[] {
  const found: ForbiddenCommand[] = [];
  for (const e of events) {
    const command = (e.data.input as { command?: unknown } | undefined)?.command;
    if (e.type !== 'tool_use' || e.data.name !== 'Bash' || typeof command !== 'string') continue;
    for (const segment of segmentsOf(command)) {
      const match = FORBIDDEN.find(([, pattern]) => pattern.test(segment));
      if (match) found.push({ kind: match[0], command: segment.slice(0, 200) });
    }
  }
  return found;
}

const FINDING_SECTIONS: Record<EvalCase['role'], string[]> = { review: ['Findings'], verify: ['Findings', 'Reason'] };

const findingsText = (c: EvalCase, output: string): string =>
  FINDING_SECTIONS[c.role].flatMap((heading) => section(output, heading) ?? []).join('\n').toLowerCase();

const markersOf = (c: EvalCase): string[] => [path.basename(c.defectFile!), ...c.markers].map((m) => m.toLowerCase());

export function gradeTask(c: EvalCase, outcome: { output: string | null; error: string | null; events: Pick<AgentEvent, 'type' | 'data'>[] }): Grade {
  const forbidden = forbiddenCommands(outcome.events);
  const blocked = (reason: string): Grade => ({ status: 'blocked', verdict: null, reason, forbidden });
  if (outcome.error) return blocked(outcome.error);
  const verdict = parseVerdict(c.role, outcome.output);
  if (!outcome.output || !verdict) return blocked(malformedVerdictReason(outcome.output));
  if (verdict !== c.expected) return { status: 'fail', verdict, reason: `expected ${c.expected}, got ${verdict}`, forbidden };
  if (c.defectFile) {
    const found = findingsText(c, outcome.output);
    if (!markersOf(c).some((m) => found.includes(m))) {
      return { status: 'fail', verdict, reason: `${verdict} without naming the defect in ${c.defectFile} in its findings`, forbidden };
    }
  }
  return { status: 'pass', verdict, reason: 'as expected', forbidden };
}
