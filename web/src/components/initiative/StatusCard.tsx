import { useMutation } from '@tanstack/react-query';
import { AlertOctagon, Check, CheckCircle2, CircleDashed, Info, Loader2, UserRound, X, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { InitiativeDetail } from '@factory/shared';
import { useRunDock } from '@/components/dock/use-run-dock';
import { Button, Card, LiveDot, Tooltip } from '@/components/ui';
import { TONE, type Tone } from '@/design/tone';
import { api } from '@/lib/api';
import { nextStep, stagesFor, type NextAction, type Stage, type StageState } from '@/lib/initiative';
import { toastError, toastSuccess } from '@/lib/toasts';
import { cn, copy } from '@/lib/utils';
import type { InitiativeTab } from './tabs';

const STEP_ICONS: Record<Tone, LucideIcon> = {
  neutral: Info,
  muted: Info,
  accent: Info,
  info: Info,
  active: Loader2,
  good: CheckCircle2,
  warn: UserRound,
  bad: AlertOctagon,
};

/** What is happening on the initiative and the one thing to do about it, above the pipeline it is on. */
export function StatusCard({ detail, onTab }: { detail: InitiativeDetail; onTab: (tab: InitiativeTab, show?: string) => void }) {
  const step = nextStep(detail);
  const Icon = STEP_ICONS[step.tone];
  const isFeature = detail.initiative.kind !== 'open-prs';
  return (
    <Card className={cn('overflow-hidden', step.needsYou && TONE[step.tone].line)}>
      <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5', step.needsYou && TONE[step.tone].wash)}>
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', TONE[step.tone].fill, TONE[step.tone].ink)}>
          <Icon className={cn('size-[18px]', step.tone === 'active' && 'animate-spin [animation-duration:2.4s]')} />
        </span>
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex items-center gap-2">
            {step.live && <LiveDot />}
            <h2 className="text-md font-medium text-ink">{step.title}</h2>
          </div>
          <p className="mt-0.5 text-pretty text-sm text-ink-secondary">{step.detail}</p>
        </div>
        {step.action && <StepAction action={step.action} detail={detail} onTab={onTab} primary={step.needsYou || step.action.kind === 'start-planning'} />}
      </div>
      {isFeature && <Pipeline stages={stagesFor(detail)} />}
    </Card>
  );
}

function StepAction({ action, detail, onTab, primary }: { action: NextAction; detail: InitiativeDetail; onTab: (tab: InitiativeTab, show?: string) => void; primary: boolean }) {
  const { initiative: i } = detail;
  const dock = useRunDock();
  const start = useMutation({ mutationFn: () => api.plan(i.id), onSuccess: toastSuccess('Planner started'), onError: toastError });
  const restore = useMutation({ mutationFn: () => api.updateInitiative(i.id, { status: 'draft' }), onSuccess: toastSuccess('Restored'), onError: toastError });
  const report = useMutation({ mutationFn: () => api.reportMarkdown(i.id).then(copy), onSuccess: () => toast.success('Report copied as Markdown'), onError: toastError });
  const run = () => {
    switch (action.kind) {
      case 'start-planning':
        return start.mutate();
      case 'review-plan':
      case 'answer':
        return onTab('plan');
      case 'show-blocked':
        return onTab('tickets', 'needs-you');
      case 'show-tickets':
        return onTab('tickets');
      case 'show-rules':
        return onTab('rules');
      case 'watch':
      case 'open-run':
        return action.runId && dock.watch(action.runId);
      case 'restore':
        return restore.mutate();
      case 'copy-report':
        return report.mutate();
    }
  };
  return (
    <Button variant={primary ? 'primary' : 'outline'} loading={start.isPending || restore.isPending || report.isPending} onClick={run}>
      {action.label}
    </Button>
  );
}

const STAGE_STYLES: Record<StageState, { dot: string; label: string; sub: string }> = {
  done: { dot: 'bg-tone-good-fill text-ink-good', label: 'text-ink', sub: 'Done' },
  active: { dot: 'bg-tone-active-fill text-ink-alert', label: 'text-ink', sub: 'In progress' },
  attention: { dot: 'bg-tone-warn-fill text-ink-warn', label: 'text-ink', sub: 'Needs you' },
  failed: { dot: 'bg-tone-bad-fill text-ink-bad', label: 'text-ink', sub: 'Failed' },
  pending: { dot: 'bg-neutral-subtle text-ink-disabled', label: 'text-ink-tertiary', sub: 'Not yet' },
  skipped: { dot: 'border border-dashed border-line text-ink-disabled', label: 'text-ink-tertiary', sub: 'Off' },
};

const STAGE_HINTS: Record<Stage['key'], string> = {
  plan: 'A planner reads the repository and writes the plan and tickets.',
  plan_review: 'A second agent checks the plan against the code.',
  approval: 'You, or the arbiter on your behalf, approve the plan. Nothing is built before this.',
  build: 'Each ticket gets its own branch and a fresh executor, then the checks run.',
  review: 'A fresh reviewer reads each diff and approves it or asks for changes.',
  fix: 'A fresh fixer handles findings, failing CI, conflicts and PR comments.',
  ship: 'Approved pull requests are ready to merge, or merge through the queue.',
};

function StageDot({ state }: { state: StageState }) {
  return (
    <span className={cn('relative grid size-6 shrink-0 place-items-center rounded-full', STAGE_STYLES[state].dot)}>
      {state === 'done' ? (
        <Check className="size-3.5" strokeWidth={2.5} />
      ) : state === 'failed' ? (
        <X className="size-3.5" strokeWidth={2.5} />
      ) : state === 'active' ? (
        <span className="size-2 animate-breathe rounded-full bg-current" />
      ) : state === 'attention' ? (
        <span className="size-2 rounded-full bg-current" />
      ) : (
        <CircleDashed className="size-3.5" />
      )}
    </span>
  );
}

function Pipeline({ stages }: { stages: Stage[] }) {
  return (
    <ol aria-label="Pipeline" className="no-scrollbar flex items-center overflow-x-auto border-t border-line-subtle px-4 py-3">
      {stages.map((s, n) => (
        <li key={s.key} className="flex min-w-0 flex-1 items-center last:flex-none">
          <Tooltip content={STAGE_HINTS[s.key]}>
            <div className="flex shrink-0 items-center gap-2" aria-label={`${s.label}: ${STAGE_STYLES[s.state].sub}${s.sub ? `, ${s.sub}` : ''}`}>
              <StageDot state={s.state} />
              <div className="leading-tight">
                <div className={cn('whitespace-nowrap text-sm font-medium', STAGE_STYLES[s.state].label)}>{s.label}</div>
                <div className="numeric whitespace-nowrap text-2xs text-ink-tertiary">{s.sub ?? STAGE_STYLES[s.state].sub}</div>
              </div>
            </div>
          </Tooltip>
          {n < stages.length - 1 && <span className={cn('mx-3 h-px min-w-4 flex-1', s.state === 'done' ? 'bg-tone-good-line' : 'bg-line-subtle')} />}
        </li>
      ))}
    </ol>
  );
}
