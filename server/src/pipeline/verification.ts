import { parseVerdict } from './verdict.ts';
import { section } from './plan.ts';

export interface AcceptanceCounts {
  met: number;
  unmet: number;
  unverified: number;
}

export interface VerificationFacts {
  gate: { command: string | null; result: string | null } | null;
  verdict: string;
  round: number;
  verifiedFixRounds: number;
  acceptance: AcceptanceCounts | null;
}

const RESULTS = ['met', 'unmet', 'unverified'] as const;

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function resultOf(cell: string): (typeof RESULTS)[number] | null {
  const word = /^[a-z]+/.exec(cell.toLowerCase().replace(/[*_`~\s]+/g, ' ').trim())?.[0];
  return RESULTS.find((r) => r === word) ?? null;
}

const isSeparator = (row: string[]): boolean => row.every((c) => /^:?-+:?$/.test(c));

export function parseAcceptance(reviewMd: string | null | undefined): AcceptanceCounts | null {
  const body = reviewMd ? section(reviewMd, 'Acceptance') : null;
  if (!body) return null;
  const rows = body.split('\n').filter((l) => l.trim().startsWith('|')).map(cells);
  if (!rows[0]?.some((c) => c.toLowerCase() === 'result')) return null;
  const counts: AcceptanceCounts = { met: 0, unmet: 0, unverified: 0 };
  let found = 0;
  for (const row of rows.slice(1).filter((r) => !isSeparator(r))) {
    const result = row.slice(1).map(resultOf).find((r) => r !== null);
    if (!result) return null;
    counts[result]++;
    found++;
  }
  return found ? counts : null;
}

export function gateResult(verdict: string | null | undefined): string | null {
  return /^GATE:\s*(PASS|FAIL|SKIPPED)\b/i.exec(verdict ?? '')?.[1].toUpperCase() ?? null;
}

export function verifiedFixRounds(runs: { kind: string; outputMd: string | null }[]): number {
  return runs.filter((r) => r.kind === 'verify' && parseVerdict('verify', r.outputMd) === 'APPROVE').length;
}

export function renderVerification(f: VerificationFacts): string {
  const bullets: string[] = [];
  if (f.gate?.result) {
    const command = f.gate.command?.replace(/\s+/g, ' ').trim();
    bullets.push(`Checks command${command ? ` \`${command}\`` : ''}: ${f.gate.result}`);
  }
  bullets.push(`Review round ${f.round}: ${f.verdict}`);
  if (f.verifiedFixRounds > 0) bullets.push(`Fix rounds approved by a verifier: ${f.verifiedFixRounds}`);
  if (f.acceptance) {
    bullets.push(`Acceptance checks, as the reviewer read them: ${f.acceptance.met} met, ${f.acceptance.unmet} unmet, ${f.acceptance.unverified} unverified`);
  }
  return ['**Factory checks**', '', ...bullets.map((b) => `- ${b}`), '', "Not run here: tests. They run in this PR's CI."].join('\n');
}
