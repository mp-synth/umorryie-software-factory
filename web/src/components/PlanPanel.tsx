import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Eye,
  FlaskConical,
  HelpCircle,
  MessageSquareWarning,
  Play,
  RotateCcw,
  ShieldAlert,
  Target,
  UserCheck,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { InitiativeDetail, Run } from '@factory/shared';
import { api } from '@/lib/api';
import { runKind, findSucceededRun, isRunInFlight } from '@/lib/status';
import { cn, money, pad2, runDuration } from '@/lib/utils';
import { useNow } from '@/lib/live';
import { toastError, toastSuccess } from '@/lib/toasts';
import { Markdown } from './Markdown';
import { VerdictPill } from './StatusPill';
import { useRunDrawer } from './RunDrawer';
import { Button, Card, CardHeader, Chip, Skeleton, Textarea, LiveDot } from './ui';

export function PlanPanel({ detail }: { detail: InitiativeDetail }) {
  const { initiative: i, runs, tickets } = detail;
  const drawer = useRunDrawer();
  const activePlanRun = runs.find((r) => !r.ticketId && (r.kind === 'plan' || r.kind === 'plan_review') && isRunInFlight(r));
  const lastReview = findSucceededRun(runs, 'plan_review');
  const lastPlan = findSucceededRun(runs, 'plan');
  const plan = i.planJson;
  const canReplan = !['in_progress', 'done'].includes(i.status) && !activePlanRun;
  const [showReplan, setShowReplan] = useState(false);

  const start = useMutation({
    mutationFn: () => api.plan(i.id),
    onSuccess: toastSuccess('Planner started'),
    onError: toastError,
  });
  const review = useMutation({
    mutationFn: () => api.planReview(i.id),
    onSuccess: toastSuccess('Plan reviewer started'),
    onError: toastError,
  });

  return (
    <Card>
      <CardHeader
        icon={<BrainCircuit className="h-3.5 w-3.5" />}
        title="Plan"
        sub={plan ? `Round ${i.planRound} · ${tickets.length} tickets${lastPlan ? ` · ${money(lastPlan.costUsd)}` : ''}` : 'Overview first, details on demand'}
        right={
          <>
            <VerdictPill verdict={i.planVerdict} />
            {lastReview && (
              <span className="flex items-center gap-1 text-2xs text-zinc-500">
                review <VerdictPill verdict={lastReview.verdict} />
              </span>
            )}
            {activePlanRun && (
              <Button size="sm" variant="outline" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => drawer.open(activePlanRun.id)}>
                Watch {runKind[activePlanRun.kind].agent.toLowerCase()}
              </Button>
            )}
            {plan && canReplan && (
              <>
                <Button size="sm" variant="ghost" icon={<ClipboardCheck className="h-3.5 w-3.5" />} loading={review.isPending} onClick={() => review.mutate()}>
                  Review plan
                </Button>
                <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setShowReplan((v) => !v)}>
                  Re-plan
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="p-4">
        {activePlanRun && !plan && <PlanningSkeleton run={activePlanRun} onWatch={() => drawer.open(activePlanRun.id)} repo={detail.project.repoPath} />}
        {!activePlanRun && !plan && i.status !== 'needs_input' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            {i.status === 'failed' && (
              <div className="flex items-center gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 text-xs text-rose-200">
                <AlertTriangle className="h-3.5 w-3.5" /> Planning failed. Check the last run, then try again.
              </div>
            )}
            <p className="max-w-md text-xs text-zinc-500">
              A fresh planner reads the repo, works out edge cases, test strategy, success criteria and definition of done, then splits the work into
              small tickets.
            </p>
            <Button variant="primary" icon={<Play className="h-3.5 w-3.5" />} loading={start.isPending} onClick={() => start.mutate()}>
              Start planning
            </Button>
          </div>
        )}
        {i.status === 'needs_input' && <Questions detail={detail} />}
        {plan && (
          <div className="space-y-5">
            {showReplan && canReplan && <ReplanBox initiativeId={i.id} onDone={() => setShowReplan(false)} />}
            <Overview detail={detail} />
          </div>
        )}
        {activePlanRun && plan && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.05] px-3 py-2 text-xs text-cyan-200">
            <LiveDot />
            {runKind[activePlanRun.kind].agent} is working on round {activePlanRun.round}. The overview below is the previous round.
          </div>
        )}
      </div>
      {['awaiting_approval'].includes(i.status) && plan && !activePlanRun && <ApprovalBar detail={detail} />}
    </Card>
  );
}

function PlanningSkeleton({ run, onWatch, repo }: { run: Run; onWatch: () => void; repo: string }) {
  const now = useNow(1000);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl border border-cyan-400/20 bg-gradient-to-r from-cyan-400/[0.07] to-transparent px-4 py-3">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-400" />
        </span>
        <div className="min-w-0 flex-1 text-xs">
          <div className="font-medium text-cyan-100">
            {run.status === 'queued' ? 'Waiting for a free agent slot…' : `${runKind[run.kind].agent} is reading ${repo.split('/').pop()}…`}
          </div>
          <div className="text-cyan-200/50">Fresh context · {run.model} · {runDuration(run, now)}</div>
        </div>
        <Button size="sm" variant="outline" icon={<Eye className="h-3.5 w-3.5" />} onClick={onWatch}>
          Watch live
        </Button>
      </div>
      <Skeleton className="h-5 w-2/3" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-4/5" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    </div>
  );
}

function Questions({ detail }: { detail: InitiativeDetail }) {
  const { initiative: i } = detail;
  const [answer, setAnswer] = useState('');
  const send = useMutation({
    mutationFn: () => api.plan(i.id, answer),
    onSuccess: () => {
      setAnswer('');
      toast.success('Answer sent — a fresh planner is starting');
    },
    onError: toastError,
  });
  const blocked = i.planMd?.match(/##\s+Blocked\s*\n([\s\S]*?)(\n##\s|$)/i)?.[1] ?? i.planMd ?? '';
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-4 py-3">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-amber-100">The planner needs a decision from you</div>
          <Markdown className="mt-2">{blocked}</Markdown>
        </div>
      </div>
      <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Answer each question (numbered is fine). Your answer is binding for the next planner." className="min-h-[100px]" />
      <div className="flex justify-end">
        <Button variant="primary" disabled={answer.trim().length < 2} loading={send.isPending} onClick={() => send.mutate()}>
          Answer & re-plan
        </Button>
      </div>
    </div>
  );
}

function ReplanBox({ initiativeId, onDone }: { initiativeId: string; onDone: () => void }) {
  const [text, setText] = useState('');
  const send = useMutation({
    mutationFn: () => api.plan(initiativeId, text.trim() || undefined),
    onSuccess: () => {
      toast.success('A fresh planner is revising the plan');
      onDone();
    },
    onError: toastError,
  });
  return (
    <div className="space-y-2 rounded-xl border border-line bg-black/20 p-3">
      <div className="text-xs font-medium text-zinc-300">What should change?</div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Keep tickets 1–3. Merge 4 and 5. Don't touch the billing module. Add a migration rollback test." />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" loading={send.isPending} onClick={() => send.mutate()}>
          {text.trim() ? 'Send & re-plan' : 'Re-plan from scratch'}
        </Button>
      </div>
    </div>
  );
}

function Overview({ detail }: { detail: InitiativeDetail }) {
  const { initiative: i, runs, tickets } = detail;
  const p = i.planJson!;
  const lastReview = runs.find((r) => r.kind === 'plan_review' && r.status === 'succeeded' && r.round === i.planRound);
  const sections: { key: string; label: string; icon: ReactNode; items: string[] }[] = [
    { key: 'edge', label: 'Edge cases', icon: <ShieldAlert className="h-3.5 w-3.5" />, items: p.edge_cases ?? [] },
    { key: 'test', label: 'Test strategy', icon: <FlaskConical className="h-3.5 w-3.5" />, items: p.test_strategy ?? [] },
    { key: 'risks', label: 'Risks', icon: <AlertTriangle className="h-3.5 w-3.5" />, items: p.risks ?? [] },
    { key: 'assumptions', label: 'Assumptions', icon: <CircleDot className="h-3.5 w-3.5" />, items: p.assumptions ?? [] },
    { key: 'oos', label: 'Out of scope', icon: <MessageSquareWarning className="h-3.5 w-3.5" />, items: p.out_of_scope ?? [] },
  ];
  const waves = Math.max(0, ...tickets.map((t) => t.wave)) + 1;
  return (
    <div className="space-y-5">
      <div>
        <div className="section-title mb-1.5 flex items-center gap-1.5">
          <Target className="h-3 w-3" /> Goal
        </div>
        <p className="text-[15px] leading-relaxed text-zinc-100">{p.goal}</p>
        <ul className="mt-3 space-y-1.5">
          {p.summary.map((s, n) => (
            <li key={n} className="flex gap-2.5 text-[13px] leading-relaxed text-zinc-300">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-violet-400" />
              {s}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Chip>{tickets.length} tickets</Chip>
          <Chip>{waves} wave{waves > 1 ? 's' : ''} of parallel work</Chip>
          <Chip>sizes {['XS', 'S', 'M'].map((s) => `${tickets.filter((t) => t.size === s).length}${s}`).join(' ')}</Chip>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <ListBox title="Success criteria" tone="emerald" items={p.success_criteria} icon={<Check className="h-3 w-3" />} />
        <ListBox title="Definition of done" tone="violet" items={p.definition_of_done} icon={<CircleDot className="h-3 w-3" />} />
      </div>

      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
        {sections
          .filter((s) => s.items.length)
          .map((s) => (
            <Disclosure key={s.key} label={s.label} icon={s.icon} count={s.items.length}>
              <ul className="space-y-1.5">
                {s.items.map((it, n) => (
                  <li key={n} className="flex gap-2.5 text-xs leading-relaxed text-zinc-300">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-zinc-500" />
                    {it}
                  </li>
                ))}
              </ul>
            </Disclosure>
          ))}
        {lastReview?.outputMd && (
          <Disclosure label="Plan review" icon={<ClipboardCheck className="h-3.5 w-3.5" />} right={<VerdictPill verdict={lastReview.verdict} />}>
            <Markdown>{lastReview.outputMd.split('\n').slice(1).join('\n')}</Markdown>
          </Disclosure>
        )}
        {i.planMd && (
          <Disclosure label="Full plan (plan.md)" icon={<BrainCircuit className="h-3.5 w-3.5" />}>
            <Markdown>{i.planMd.split('\n').slice(1).join('\n')}</Markdown>
          </Disclosure>
        )}
      </div>
    </div>
  );
}

function ListBox({ title, items, tone, icon }: { title: string; items: string[]; tone: 'emerald' | 'violet'; icon: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-black/20 p-3.5">
      <div className="section-title mb-2">{title}</div>
      <ul className="space-y-2">
        {items.map((s, n) => (
          <li key={n} className="flex gap-2.5 text-xs leading-relaxed text-zinc-300">
            <span
              className={cn(
                'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full',
                tone === 'emerald' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-violet-400/15 text-violet-300',
              )}
            >
              {icon}
            </span>
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Disclosure({ label, icon, count, right, children, defaultOpen }: { label: string; icon?: ReactNode; count?: number; right?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2.5 bg-surface-2/40 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2">
        <ChevronRight className={cn('h-3.5 w-3.5 text-zinc-500 transition-transform', open && 'rotate-90')} />
        <span className="text-zinc-500">{icon}</span>
        <span className="flex-1 text-xs font-medium text-zinc-200">{label}</span>
        {count !== undefined && <span className="rounded-full bg-white/5 px-1.5 text-2xs tabular-nums text-zinc-400">{count}</span>}
        {right}
      </button>
      {open && <div className="animate-fade-in px-4 py-3">{children}</div>}
    </div>
  );
}

function ApprovalBar({ detail }: { detail: InitiativeDetail }) {
  const { initiative: i, tickets } = detail;
  const [text, setText] = useState('');
  const approve = useMutation({
    mutationFn: () => api.approve(i.id, text.trim() || undefined),
    onSuccess: () => toast.success(i.settings.autoExecute ? 'Approved — building the first wave' : 'Approved'),
    onError: toastError,
  });
  const change = useMutation({
    mutationFn: () => api.plan(i.id, text.trim()),
    onSuccess: () => {
      setText('');
      toast.success('Feedback sent — a fresh planner is revising');
    },
    onError: toastError,
  });
  const firstWave = tickets.filter((t) => t.wave === 0).length;
  return (
    <div className="border-t border-amber-400/20 bg-gradient-to-b from-amber-400/[0.06] to-transparent px-4 py-4">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-amber-400/30 bg-amber-400/10 text-amber-300">
          <UserCheck className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-amber-50">Your call</div>
          <p className="text-xs text-zinc-400">
            Approve to {i.settings.autoExecute ? `start building ${firstWave} ticket${firstWave > 1 ? 's' : ''} in the first wave` : 'unlock the tickets'}, or tell the
            planner what to change. Tickets can be edited before they start.
          </p>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Optional note, or the changes you want (what's good, what to change, what not to touch)…"
            className="mt-3 min-h-[64px] bg-black/40"
          />
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" disabled={text.trim().length < 3} loading={change.isPending} onClick={() => change.mutate()} icon={<RotateCcw className="h-3.5 w-3.5" />}>
              Request changes
            </Button>
            <Button variant="primary" loading={approve.isPending} onClick={() => approve.mutate()} icon={<Check className="h-3.5 w-3.5" />}>
              Approve {i.settings.autoExecute ? '& build' : 'plan'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function seqLabel(n: number | null | undefined): string {
  return n ? pad2(n) : '—';
}
