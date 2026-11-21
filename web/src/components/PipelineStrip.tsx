import { Check, type LucideIcon } from 'lucide-react';
import { BrainCircuit, ClipboardCheck, Hammer, Rocket, ScanSearch, UserCheck, Wrench } from 'lucide-react';
import type { InitiativeDetail } from '@factory/shared';
import { cn } from '@/lib/utils';

type State = 'done' | 'active' | 'attention' | 'pending' | 'skipped' | 'failed';

interface Stage {
  label: string;
  icon: LucideIcon;
  state: State;
  sub?: string;
}

export function stagesFor(d: InitiativeDetail): Stage[] {
  const { initiative: i, tickets, runs } = d;
  const total = tickets.filter((t) => t.status !== 'canceled').length;
  const count = (pred: (s: string) => boolean) => tickets.filter((t) => pred(t.status)).length;
  const approvedOrMerged = count((s) => s === 'approved' || s === 'merged');
  const merged = count((s) => s === 'merged');
  const built = count((s) => !['proposed', 'todo', 'building', 'canceled'].includes(s));
  const planReviewRun = runs.find((r) => r.kind === 'plan_review' && r.status === 'succeeded');
  const fixRuns = runs.filter((r) => r.kind === 'fix' && r.status === 'succeeded').length;
  const approved = !!i.approvedAt;

  const plan: State =
    i.status === 'planning' ? 'active' : i.status === 'failed' ? 'failed' : i.status === 'needs_input' ? 'attention' : i.planJson ? 'done' : 'pending';
  const review: State =
    i.status === 'plan_review' ? 'active' : planReviewRun ? 'done' : i.planJson && !i.settings.autoPlanReview ? 'skipped' : 'pending';
  const approval: State = approved ? 'done' : ['awaiting_approval', 'needs_input'].includes(i.status) ? 'attention' : 'pending';
  const build: State = !approved
    ? 'pending'
    : count((s) => s === 'building' || s === 'checking') > 0
      ? 'active'
      : total > 0 && built === total
        ? 'done'
        : built > 0
          ? 'active'
          : 'pending';
  const rev: State = !approved
    ? 'pending'
    : count((s) => s === 'in_review') > 0
      ? 'active'
      : total > 0 && approvedOrMerged === total
        ? 'done'
        : approvedOrMerged > 0
          ? 'active'
          : 'pending';
  const fix: State = !approved
    ? 'pending'
    : count((s) => s === 'fixing') > 0
      ? 'active'
      : count((s) => s === 'blocked' || s === 'changes_requested') > 0
        ? 'attention'
        : fixRuns > 0
          ? 'done'
          : 'pending';
  const ship: State = i.status === 'done' ? 'done' : approvedOrMerged > 0 ? 'active' : 'pending';

  return [
    { label: 'Plan', icon: BrainCircuit, state: plan, sub: i.planRound ? `round ${i.planRound}` : undefined },
    { label: 'Plan review', icon: ClipboardCheck, state: review },
    { label: 'Your approval', icon: UserCheck, state: approval },
    { label: 'Build', icon: Hammer, state: build, sub: approved ? `${built}/${total}` : undefined },
    { label: 'Review', icon: ScanSearch, state: rev, sub: approved ? `${approvedOrMerged}/${total}` : undefined },
    { label: 'Fix', icon: Wrench, state: fix, sub: fixRuns ? `${fixRuns} round${fixRuns > 1 ? 's' : ''}` : undefined },
    { label: 'Ship', icon: Rocket, state: ship, sub: merged ? `${merged} merged` : approvedOrMerged ? `${approvedOrMerged} ready` : undefined },
  ];
}

const dot: Record<State, string> = {
  done: 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300',
  active: 'border-cyan-400/50 bg-cyan-400/10 text-cyan-300 animate-pulse-ring',
  attention: 'border-amber-400/50 bg-amber-400/10 text-amber-300',
  failed: 'border-rose-500/50 bg-rose-500/10 text-rose-300',
  pending: 'border-line-strong bg-surface-2 text-zinc-600',
  skipped: 'border-dashed border-line-strong bg-transparent text-zinc-700',
};

export function PipelineStrip({ detail }: { detail: InitiativeDetail }) {
  const stages = stagesFor(detail);
  return (
    <div className="card overflow-x-auto px-4 py-3.5">
      <ol className="flex min-w-[720px] items-center">
        {stages.map((s, idx) => (
          <li key={s.label} className="flex flex-1 items-center last:flex-none">
            <div className="flex items-center gap-2.5">
              <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full border transition-colors', dot[s.state])}>
                {s.state === 'done' ? <Check className="h-3.5 w-3.5" /> : <s.icon className="h-3.5 w-3.5" />}
              </span>
              <div className="leading-tight">
                <div className={cn('text-xs font-medium', s.state === 'pending' || s.state === 'skipped' ? 'text-zinc-500' : 'text-zinc-200')}>{s.label}</div>
                <div className="text-2xs text-zinc-500">{s.state === 'skipped' ? 'off' : s.sub ?? (s.state === 'attention' ? 'needs you' : s.state === 'active' ? 'running' : ' ')}</div>
              </div>
            </div>
            {idx < stages.length - 1 && (
              <div className={cn('mx-3 h-px min-w-[16px] flex-1', s.state === 'done' ? 'bg-gradient-to-r from-emerald-400/40 to-line-strong' : 'bg-line-strong')} />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
