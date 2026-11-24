import type { AgentResult } from '../agents/claude.ts';
import { firstLine } from './plan.ts';

export type VerdictKind = 'plan' | 'plan_review' | 'execute' | 'review' | 'fix' | 'verify' | 'arbitrate' | 'steer' | 'retro';

interface VerdictSpec {
  prefix: string;
  tokens: readonly string[];
}

export const VERDICTS: Record<VerdictKind, VerdictSpec> = {
  plan: { prefix: 'PLAN', tokens: ['READY', 'BLOCKED'] },
  plan_review: { prefix: 'VERDICT', tokens: ['PASS', 'REVISE'] },
  execute: { prefix: 'STATUS', tokens: ['READY', 'BLOCKED'] },
  review: { prefix: 'VERDICT', tokens: ['APPROVE', 'CHANGES'] },
  fix: { prefix: 'FIX', tokens: ['APPLIED', 'NO-CHANGES', 'NOTHING-TO-DO', 'BLOCKED', 'REBUILD'] },
  verify: { prefix: 'VERDICT', tokens: ['APPROVE', 'BLOCK'] },
  arbitrate: { prefix: 'DECISION', tokens: ['APPROVE', 'RETRY', 'ESCALATE'] },
  steer: { prefix: 'ROUTE', tokens: ['TICKETS', 'REPLAN', 'NONE'] },
  retro: { prefix: 'RETRO', tokens: ['RULES', 'NO-RULES'] },
};

export function parseVerdict(kind: VerdictKind, markdown: string | null | undefined): string | null {
  const line = firstLine(markdown);
  if (!line) return null;
  const { prefix, tokens } = VERDICTS[kind];
  const match = new RegExp(`^${prefix}:\\s*([A-Z-]+)\\s*$`, 'i').exec(line);
  if (!match) return null;
  const token = match[1].toUpperCase();
  return tokens.includes(token) ? token : null;
}

export function malformedVerdictReason(markdown: string | null | undefined): string {
  return `malformed verdict: "${(firstLine(markdown) ?? '').slice(0, 120)}"`;
}

export function outputFailure(
  result: Pick<AgentResult, 'isError' | 'subtype' | 'resultText' | 'stderrTail'>,
  output: string | null,
  outputName: string,
): string | null {
  if (!output && !result.isError) return `agent did not write ${outputName}`;
  if (!result.isError) return null;
  return `agent ended with an error${result.subtype ? ` (${result.subtype})` : ''}: ${(result.resultText || result.stderrTail || 'unknown').trim().slice(0, 400)}`;
}
