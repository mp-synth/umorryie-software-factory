import type { CheckClass, CheckRule } from '@factory/shared';

export const DEFAULT_CHECK_RULES: CheckRule[] = [
  { pattern: '^Code review( gate)?$', class: 'people-only', note: 'a code-owner review' },
  { pattern: '^mergefreeze$', class: 'people-only', note: 'a merge freeze' },
  { pattern: '^Meticulous', class: 'people-only', note: 'a visual-diff approval' },
  { pattern: 'Approval Agent', class: 'people-only', note: 'an approval routed to a code owner' },
  { pattern: '^OpenAPI breaking changes$', class: 'people-only', note: 'a breaking-change approval' },
  {
    pattern: 'Bugbot|Bouncer|semgrep|codecov|coverage|sonar|vercel|netlify|preview|Notif|Emergency change|Auto-merge|Claude Code|StepSecurity|Bundle stats',
    class: 'ignore',
  },
  { pattern: '(^|[^a-z])(lint|tests?|test-unit|openapi|typecheck|type-check|contracts?)([^a-z]|$)', class: 'must-fix' },
];

export interface CheckVerdict {
  class: CheckClass;
  note: string | null;
  /** A rule depends on the failed job's log, which the caller has not read yet. */
  needsLog: boolean;
}

function matches(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(text);
  } catch {
    return false;
  }
}

/**
 * How a failing check is treated. The project's rules come first, in order, then the factory's defaults; a
 * check no rule names is must-fix when branch protection requires it and fix otherwise.
 */
export function classifyCheck(check: { name: string; aliases?: string[]; isRequired?: boolean }, projectRules: CheckRule[], log?: string | null): CheckVerdict {
  for (const rule of [...projectRules, ...DEFAULT_CHECK_RULES]) {
    if (![check.name, ...(check.aliases ?? [])].some((name) => matches(rule.pattern, name))) continue;
    if (rule.logPattern) {
      if (log === undefined) return { class: rule.class, note: rule.note ?? null, needsLog: true };
      if (!log || !matches(rule.logPattern, log)) continue;
    }
    return { class: rule.class, note: rule.note ?? null, needsLog: false };
  }
  return { class: check.isRequired ? 'must-fix' : 'fix', note: null, needsLog: false };
}

export const ACTIONABLE: CheckClass[] = ['must-fix', 'fix'];

export function validCheckRules(rules: CheckRule[]): string[] {
  return rules.flatMap((r, i) =>
    [r.pattern, r.logPattern].filter((p): p is string => !!p).flatMap((p) => {
      try {
        new RegExp(p);
        return [];
      } catch (err) {
        return [`rule ${i + 1}: ${(err as Error).message}`];
      }
    }),
  );
}
