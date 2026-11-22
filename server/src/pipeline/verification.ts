import { section } from './plan.ts';

export interface AcceptanceCounts {
  met: number;
  unmet: number;
  unverified: number;
}

export interface ReviewFacts {
  gate: string | null;
  verdict: string;
  round: number;
  acceptance: AcceptanceCounts | null;
}

interface Finding {
  severity: string | null;
  location: string | null;
  claim: string;
  scenario: string | null;
  fix: string | null;
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

const GATE_TEXT: Record<string, string> = { PASS: 'checks passed', FAIL: 'checks failed', SKIPPED: 'no checks configured' };
const FINDING_HEADER = /^(?:R[\d.]+\s+)?\[?(blocker|major|minor|nit)\]?\s+(.+)$/i;
const LOCATED_CLAIM = /^`?([^\s`]*[./:][^\s`]*)`?\s+[—–-]{1,2}\s+(.+)$/;
const SCENARIO = /^[-*]\s*\*{0,2}failure scenario\*{0,2}:\*{0,2}\s*/i;
const SUGGESTED_FIX = /^[-*]\s*\*{0,2}suggested fix\*{0,2}:\*{0,2}\s*/i;

function factsLine(f: ReviewFacts): string {
  const parts = [`**Review round ${f.round}: ${f.verdict}**`];
  if (f.gate && GATE_TEXT[f.gate]) parts.push(GATE_TEXT[f.gate]);
  if (f.acceptance) {
    const { met, unmet, unverified } = f.acceptance;
    parts.push(`acceptance ${met}/${met + unmet + unverified} met${unverified ? `, ${unverified} unverified` : ''}`);
  }
  return parts.join(' · ');
}

function field(lines: string[], label: RegExp): string | null {
  const line = lines.find((l) => label.test(l));
  return line ? line.replace(label, '').trim() || null : null;
}

function parseFinding(block: string): Finding {
  const [header, ...rest] = block.split('\n').map((l) => l.trim());
  const severity = FINDING_HEADER.exec(header);
  const claimText = severity ? severity[2] : header;
  const located = LOCATED_CLAIM.exec(claimText);
  return {
    severity: severity ? severity[1].toLowerCase() : null,
    location: located ? located[1] : null,
    claim: located ? located[2] : claimText,
    scenario: field(rest, SCENARIO),
    fix: field(rest, SUGGESTED_FIX),
  };
}

function parseFindings(reviewMd: string): Finding[] | null {
  const body = section(reviewMd, 'Findings');
  if (!body || /^none\.?$/i.test(body)) return [];
  if (!body.startsWith('###')) return null;
  return body
    .split(/^###\s+/m)
    .map((b) => b.trim())
    .filter(Boolean)
    .map(parseFinding);
}

const asSentence = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function renderFinding(f: Finding, n: number): string {
  const where = [f.severity && `**${f.severity}**`, f.location && `\`${f.location}\``].filter(Boolean).join(' ');
  const detail = [f.scenario && asSentence(f.scenario), f.fix && `Fix: ${f.fix}`].filter(Boolean).join(' ');
  return [`${n}. ${where ? `${where} — ` : ''}${f.claim}`, detail && `   ${detail}`].filter(Boolean).join('\n');
}

export function reviewComment(reviewMd: string, facts: ReviewFacts): string {
  const findings = parseFindings(reviewMd);
  const body = findings ? findings.map((f, n) => renderFinding(f, n + 1)).join('\n') : section(reviewMd, 'Findings');
  return [factsLine(facts), body].filter(Boolean).join('\n\n');
}
