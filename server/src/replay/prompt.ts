// Pure helpers for replaying a past factory step: read what its stored prompt points at,
// point it at a sandbox instead, and score how often two models reach the same verdict.
import { escapeRegExp } from '../pipeline/globs.ts';
import { BASE_COMMIT_FIELD, INPUTS_LABEL, OUTPUT_LABEL, ROLE_FILES, type AgentKind } from '../pipeline/role-prompt.ts';

/** Agent steps that write one file: a plan writes several (`Outputs:`), and a gate runs the checks command, not an agent. */
export const REPLAYABLE_KINDS: readonly AgentKind[] = (Object.keys(ROLE_FILES) as AgentKind[]).filter((k) => k !== 'plan');

/** The file the step was told to write (`Output: <path>`). */
export function outputPathOf(prompt: string): string | null {
  return prompt.match(new RegExp(`^${OUTPUT_LABEL}: (.+)$`, 'm'))?.[1].trim() ?? null;
}

/** The commit a base checkout was at (`Base commit: origin/main at 3df9f71…`). */
export function baseCommitOf(prompt: string): string | null {
  return fieldOf(prompt, BASE_COMMIT_FIELD)?.match(/ at ([0-9a-f]{7,40})\b/)?.[1] ?? null;
}

export function fieldOf(prompt: string, name: string): string | null {
  return prompt.match(new RegExp(`^${escapeRegExp(name)}(?: \\([^)]*\\))?: (.+)$`, 'm'))?.[1].trim() ?? null;
}

/** The input files listed under `Inputs:`. */
export function inputsOf(prompt: string): string[] {
  const block = prompt.match(new RegExp(`^${INPUTS_LABEL}:\\n((?:- .+\\n?)+)`, 'm'))?.[1] ?? '';
  return block
    .split('\n')
    .map((l) => l.replace(/^- /, '').trim())
    .filter(Boolean);
}

/**
 * Replaces every occurrence of each path, longest first so a parent never shadows its child,
 * and only as a whole path: `/w/Enact` does not touch `/w/Enact-old`.
 */
export function repointPrompt(prompt: string, moves: [from: string, to: string][]): string {
  let out = prompt;
  for (const [from, to] of [...moves].sort((a, b) => b[0].length - a[0].length)) {
    out = out.replace(new RegExp(`${escapeRegExp(from)}(?=[/\\s\`'"),:;]|$)`, 'gm'), () => to);
  }
  return out;
}

/** Every git worktree under `<home>/worktrees/` a text names (ticket worktrees, base checkouts). */
export function worktreePathsIn(text: string, home: string): string[] {
  const root = escapeRegExp(`${home}/worktrees/`);
  const found = new Set<string>();
  for (const m of text.matchAll(new RegExp(`${root}[^\\s\`'"(),;]+`, 'g'))) {
    const p = m[0].replace(/[.:]+$/, '');
    // a worktree is <project>/<initiative>/<ticket> or <project>/_base/<branch>-<sha>; deeper paths are files inside one
    const parts = p.slice(`${home}/worktrees/`.length).split('/');
    if (parts.length >= 3) found.add(`${home}/worktrees/${parts.slice(0, 3).join('/')}`);
  }
  return [...found];
}

/** The file's text, or null when it is not valid UTF-8 (a binary file). */
export function utf8Text(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** The commit a base checkout's folder is named after (`_base/master-3df9f7175755`). */
export function baseCheckoutCommit(worktree: string): string | null {
  return worktree.match(/\/_base\/.+-([0-9a-f]{12})$/)?.[1] ?? null;
}

/** The verdict word from a step's first line: `DECISION: APPROVE` → `APPROVE`. */
export function verdictWord(firstLine: string | null | undefined): string | null {
  return firstLine?.match(/^[A-Z][A-Z -]*:\s*([A-Z][A-Z-]*)/)?.[1] ?? null;
}

export interface ReplaySlot<C> {
  c: C;
  model: string;
  repeat: number;
}

/**
 * The order replays run in: every case once with each model, then again for the next repeat,
 * with the models' order flipped each repeat. Cutting this list short keeps whole cases.
 */
export function replayOrder<C>(cases: C[], models: string[], repeats: number): ReplaySlot<C>[] {
  const out: ReplaySlot<C>[] = [];
  for (let repeat = 1; repeat <= repeats; repeat++) {
    const order = repeat % 2 ? models : [...models].reverse();
    for (const c of cases) for (const model of order) out.push({ c, model, repeat });
  }
  return out;
}

export interface ReplayOutcome {
  caseId: string;
  arm: string;
  verdict: string | null;
}

export interface ArmAgreement {
  arm: string;
  /** Share of an arm's replays that reached the verdict the original run reached. */
  withOriginal: number;
  /** Share of cases replayed more than once whose replays in this arm all agreed; null when none was. */
  selfConsistent: number | null;
  replays: number;
  failed: number;
}

export function agreement(original: Map<string, string | null>, outcomes: ReplayOutcome[]): ArmAgreement[] {
  const arms = [...new Set(outcomes.map((o) => o.arm))].sort();
  return arms.map((arm) => {
    const mine = outcomes.filter((o) => o.arm === arm);
    const done = mine.filter((o) => o.verdict);
    const byCase = new Map<string, string[]>();
    for (const o of done) byCase.set(o.caseId, [...(byCase.get(o.caseId) ?? []), o.verdict!]);
    const repeated = [...byCase.values()].filter((v) => v.length > 1);
    const consistent = repeated.filter((v) => new Set(v).size === 1).length;
    return {
      arm,
      withOriginal: done.length ? done.filter((o) => o.verdict === original.get(o.caseId)).length / done.length : 0,
      selfConsistent: repeated.length ? consistent / repeated.length : null,
      replays: mine.length,
      failed: mine.length - done.length,
    };
  });
}

/** Share of cases where the two arms' most common verdicts match; a tie goes to the verdict an arm reached first. */
export function crossAgreement(outcomes: ReplayOutcome[], a: string, b: string): { agree: number; cases: number; differ: string[] } {
  const mode = (arm: string, caseId: string) => {
    const counts = new Map<string, number>();
    for (const o of outcomes) if (o.arm === arm && o.caseId === caseId && o.verdict) counts.set(o.verdict, (counts.get(o.verdict) ?? 0) + 1);
    return [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
  };
  const cases = [...new Set(outcomes.map((o) => o.caseId))];
  const both = cases.filter((c) => mode(a, c) && mode(b, c));
  const differ = both.filter((c) => mode(a, c) !== mode(b, c));
  return { agree: both.length ? (both.length - differ.length) / both.length : 0, cases: both.length, differ };
}
