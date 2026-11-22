import { SIZE_BUDGETS, overSizeBudget } from '@factory/shared';

export function sizeNote(size: string | null, linesChanged: number | null | undefined): string | null {
  if (!size || linesChanged == null || !overSizeBudget(size, linesChanged)) return null;
  return `${linesChanged} lines changed outside tests, lockfiles and generated files; the plan sized this ${size} (about ${SIZE_BUDGETS[size]})`;
}
