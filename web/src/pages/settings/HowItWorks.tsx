import type { RunKind } from '@factory/shared';
import { AgentGlyph } from '@/components/AgentGlyph';
import { Card } from '@/components/ui';

const STEPS: [title: string, body: string, kind: RunKind | null][] = [
  ['Plan', 'A fresh planner (Opus) reads the repo read-only and writes plan.md and plan.json: goal, success criteria, definition of done, edge cases, test strategy, and small dependency-ordered tickets. The server validates the JSON (schema, sizes, DAG).', 'plan'],
  ['Plan review', 'A second fresh agent checks coverage, slicing, dependencies and that every path the plan names exists. REVISE sends a new planner its findings.', 'plan_review'],
  ['Your approval', 'You read the high-level overview first, then approve or request changes. Nothing touches code before this. With the arbiter on, it decides for you unless it needs you.', null],
  ['Build', 'Each ticket gets its own git worktree and factory/* branch, stacked on its dependency when needed, and a fresh executor that commits there.', 'execute'],
  ['Checks', 'The project checks command runs in the worktree. A failure goes to a fixer, so no reviewer time is spent on a red build. Green branches are pushed and opened as draft PRs.', 'gate'],
  ['Review', 'A fresh reviewer with no memory of the build reads the diff, verifies each finding and answers APPROVE or CHANGES.', 'review'],
  ['Fix', 'A fresh fixer triages every finding, failing CI check, merge conflict, unresolved PR thread and your feedback as VALID, INVALID or NEEDS-HUMAN, fixes what is real with tests, then checks and review run again.', 'fix'],
];

export function HowItWorks() {
  return (
    <Card>
      <ol className="divide-y divide-line-subtle">
        {STEPS.map(([title, body, kind], n) => (
          <li key={title} className="flex gap-4 px-4 py-4">
            {kind ? (
              <AgentGlyph kind={kind} />
            ) : (
              <span className="numeric grid size-7 shrink-0 place-items-center rounded-lg bg-tone-warn-fill text-xs font-medium text-ink-warn">{n + 1}</span>
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink">
                <span className="numeric mr-1.5 text-ink-tertiary">{n + 1}.</span>
                {title}
              </div>
              <p className="mt-0.5 text-pretty text-sm leading-relaxed text-ink-secondary">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
