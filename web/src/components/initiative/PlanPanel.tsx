import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, BrainCircuit, Check, CircleDot, ClipboardCheck, Eye, FlaskConical, MessageSquareWarning, Play, RotateCcw, ShieldAlert, Target, UserCheck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { InitiativeDetail, Run } from '@factory/shared';
import { AgentGlyph } from '@/components/AgentGlyph';
import { useRunDock } from '@/components/dock/use-run-dock';
import { Markdown } from '@/components/Markdown';
import { VerdictBadge } from '@/components/StatusBadge';
import { Button, Callout, Card, CardHeader, Chip, Disclosure, EmptyState, LiveDot, Skeleton, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { activePlanRun } from '@/lib/initiative';
import { useNow } from '@/lib/live';
import { MOD } from '@/lib/shortcuts';
import { findSucceededRun, runKind } from '@/lib/status';
import { toastError, toastSuccess } from '@/lib/toasts';
import { cn, money, runDuration } from '@/lib/utils';

export function PlanPanel({ detail }: { detail: InitiativeDetail }) {
  const { initiative: i, runs, tickets } = detail;
  const dock = useRunDock();
  const planRun = activePlanRun(runs);
  const lastReview = findSucceededRun(runs, 'plan_review');
  const lastPlan = findSucceededRun(runs, 'plan');
  const plan = i.planJson;
  const canReplan = !['in_progress', 'done'].includes(i.status) && !planRun;
  const [showReplan, setShowReplan] = useState(false);
  const start = useMutation({ mutationFn: () => api.plan(i.id), onSuccess: toastSuccess('Planner started'), onError: toastError });
  const review = useMutation({ mutationFn: () => api.planReview(i.id), onSuccess: toastSuccess('Plan reviewer started'), onError: toastError });
  const awaiting = i.status === 'awaiting_approval' && !!plan && !planRun;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          icon={<BrainCircuit />}
          title="Plan"
          description={plan ? `Round ${i.planRound} · ${tickets.length} tickets${lastPlan ? ` · planned for ${money(lastPlan.costUsd)}` : ''}` : 'An overview first, the details on demand'}
          actions={
            <>
              {i.planVerdict && <VerdictBadge verdict={i.planVerdict} />}
              {lastReview && (
                <span className="flex items-center gap-1.5 text-xs text-ink-tertiary">
                  Review <VerdictBadge verdict={lastReview.verdict} />
                </span>
              )}
              {planRun && (
                <Button size="sm" variant="outline" icon={<Eye />} onClick={() => dock.watch(planRun.id)}>
                  Watch the {runKind[planRun.kind].agent.toLowerCase()}
                </Button>
              )}
              {plan && canReplan && (
                <>
                  <Button size="sm" variant="ghost" icon={<ClipboardCheck />} loading={review.isPending} onClick={() => review.mutate()}>
                    Review again
                  </Button>
                  <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => setShowReplan((v) => !v)} aria-expanded={showReplan}>
                    Re-plan
                  </Button>
                </>
              )}
            </>
          }
        />
        <div className="p-4">
          {planRun && !plan && <PlanningSkeleton run={planRun} onWatch={() => dock.watch(planRun.id)} repo={detail.project.repoPath} />}
          {!planRun && !plan && i.status !== 'needs_input' && (
            <EmptyState
              icon={<BrainCircuit />}
              title={i.status === 'failed' ? 'Planning failed' : 'No plan yet'}
              actions={
                <Button variant="primary" icon={<Play />} loading={start.isPending} onClick={() => start.mutate()}>
                  {i.status === 'failed' ? 'Plan again' : 'Start planning'}
                </Button>
              }
            >
              {i.status === 'failed'
                ? 'Open the last planner run in the live panel to see what went wrong, then plan again.'
                : 'A fresh planner reads the repository, works out edge cases, test strategy, success criteria and the definition of done, then splits the work into small tickets.'}
            </EmptyState>
          )}
          {i.status === 'needs_input' && !planRun && <Questions detail={detail} />}
          {plan && (
            <div className="space-y-5">
              {showReplan && canReplan && <ReplanBox initiativeId={i.id} onDone={() => setShowReplan(false)} />}
              {planRun && (
                <Callout tone="active" icon={<LiveDot />} title={planRun.kind === 'arbitrate' ? `The arbiter is deciding on round ${planRun.round} for you.` : `The ${runKind[planRun.kind].agent.toLowerCase()} is working on round ${planRun.round}.`}>
                  What you see below is the previous round.
                </Callout>
              )}
              <Overview detail={detail} />
            </div>
          )}
        </div>
      </Card>
      {awaiting && <ApprovalBar detail={detail} />}
    </div>
  );
}

function PlanningSkeleton({ run, onWatch, repo }: { run: Run; onWatch: () => void; repo: string }) {
  const now = useNow(1000);
  return (
    <div className="space-y-4">
      <Callout
        tone="active"
        icon={<AgentGlyph kind={run.kind} size="sm" />}
        title={run.status === 'queued' ? 'Waiting for a free agent slot…' : `The ${runKind[run.kind].agent.toLowerCase()} is reading ${repo.split('/').pop()}…`}
        actions={
          <Button size="sm" variant="outline" icon={<Eye />} onClick={onWatch}>
            Watch live
          </Button>
        }
      >
        Fresh context · {run.model} · <span className="numeric">{runDuration(run, now)}</span>. The plan shows up here as soon as it is written.
      </Callout>
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
      toast.success('Answer sent. A fresh planner is starting.');
    },
    onError: toastError,
  });
  const blocked = i.planMd?.match(/##\s+Blocked\s*\n([\s\S]*?)(\n##\s|$)/i)?.[1] ?? i.planMd ?? '';
  const ready = answer.trim().length >= 2;
  return (
    <div className="space-y-3">
      <Callout tone="warn" title="The planner needs a decision from you">
        <Markdown className="mt-1">{blocked}</Markdown>
      </Callout>
      <Textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ready && send.mutate()}
        placeholder="Answer each question; numbered is fine. Your answer is binding for the next planner."
        className="min-h-[7rem]"
        aria-label="Your answer"
      />
      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-ink-tertiary">{MOD}↵ to send</span>
        <Button variant="primary" disabled={!ready} loading={send.isPending} onClick={() => send.mutate()}>
          Answer and re-plan
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
    <div className="space-y-2 rounded-lg border border-line-subtle bg-sunken p-3">
      <div className="text-sm font-medium text-ink">What should change?</div>
      <Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Keep tickets 1–3. Merge 4 and 5. Don't touch the billing module. Add a migration rollback test." />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" loading={send.isPending} onClick={() => send.mutate()}>
          {text.trim() ? 'Send and re-plan' : 'Re-plan from scratch'}
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
    { key: 'edge', label: 'Edge cases', icon: <ShieldAlert />, items: p.edge_cases ?? [] },
    { key: 'test', label: 'Test strategy', icon: <FlaskConical />, items: p.test_strategy ?? [] },
    { key: 'risks', label: 'Risks', icon: <AlertTriangle />, items: p.risks ?? [] },
    { key: 'assumptions', label: 'Assumptions', icon: <CircleDot />, items: p.assumptions ?? [] },
    { key: 'oos', label: 'Out of scope', icon: <MessageSquareWarning />, items: p.out_of_scope ?? [] },
  ];
  const planned = tickets.filter((t) => t.status !== 'canceled');
  const longest = Math.max(0, ...planned.map((t) => t.wave)) + 1;
  const perWave = planned.reduce((m, t) => m.set(t.wave, (m.get(t.wave) ?? 0) + 1), new Map<number, number>());
  const widest = Math.max(0, ...perWave.values());
  return (
    <div className="space-y-5">
      <div>
        <div className="eyebrow mb-1.5 flex items-center gap-1.5">
          <Target className="size-3.5" /> Goal
        </div>
        <p className="text-pretty text-lg leading-relaxed text-ink">{p.goal}</p>
        <ul className="mt-3 space-y-1.5">
          {p.summary.map((s, n) => (
            <li key={n} className="flex gap-2.5 text-sm leading-relaxed text-ink-secondary">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-[var(--fill-accent)]" />
              {s}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Chip>{tickets.length} tickets</Chip>
          <Chip>
            {longest} ticket{longest > 1 ? 's' : ''} in the longest line
          </Chip>
          <Chip>
            up to {widest} at once{widest > i.settings.concurrency ? ` (Parallel is ${i.settings.concurrency})` : ''}
          </Chip>
          <Chip>sizes {['XS', 'S', 'M'].map((s) => `${tickets.filter((t) => t.size === s).length}${s}`).join(' ')}</Chip>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
        <ListBox title="Success criteria" items={p.success_criteria} icon={<Check className="size-3" />} tone="good" />
        <ListBox title="Definition of done" items={p.definition_of_done} icon={<CircleDot className="size-3" />} tone="accent" />
      </div>

      <div className="divide-y divide-line-subtle overflow-hidden rounded-lg border border-line-subtle">
        {sections
          .filter((s) => s.items.length)
          .map((s) => (
            <Disclosure key={s.key} label={s.label} icon={s.icon} count={s.items.length}>
              <ul className="space-y-1.5">
                {s.items.map((it, n) => (
                  <li key={n} className="flex gap-2.5 text-sm leading-relaxed text-ink-secondary">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-ink-tertiary" />
                    {it}
                  </li>
                ))}
              </ul>
            </Disclosure>
          ))}
        {lastReview?.outputMd && (
          <Disclosure label="Plan review" icon={<ClipboardCheck />} aside={<VerdictBadge verdict={lastReview.verdict} />}>
            <Markdown>{lastReview.outputMd.split('\n').slice(1).join('\n')}</Markdown>
          </Disclosure>
        )}
        {i.planMd && (
          <Disclosure label="The full plan (plan.md)" icon={<BrainCircuit />}>
            <Markdown>{i.planMd.split('\n').slice(1).join('\n')}</Markdown>
          </Disclosure>
        )}
      </div>
    </div>
  );
}

function ListBox({ title, items, icon, tone }: { title: string; items: string[]; icon: ReactNode; tone: 'good' | 'accent' }) {
  return (
    <div className="rounded-lg border border-line-subtle p-3.5">
      <div className="eyebrow mb-2">{title}</div>
      <ul className="space-y-2">
        {items.map((s, n) => (
          <li key={n} className="flex gap-2.5 text-sm leading-relaxed text-ink-secondary">
            <span className={cn('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full', tone === 'good' ? 'bg-tone-good-fill text-ink-good' : 'bg-tone-accent-fill text-ink-accent')}>{icon}</span>
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ApprovalBar({ detail }: { detail: InitiativeDetail }) {
  const { initiative: i, tickets } = detail;
  const [text, setText] = useState('');
  const approve = useMutation({
    mutationFn: () => api.approve(i.id, text.trim() || undefined),
    onSuccess: () => toast.success(i.settings.autoExecute ? 'Approved. Building the first wave.' : 'Approved'),
    onError: toastError,
  });
  const change = useMutation({
    mutationFn: () => api.plan(i.id, text.trim()),
    onSuccess: () => {
      setText('');
      toast.success('Feedback sent. A fresh planner is revising.');
    },
    onError: toastError,
  });
  const firstWave = tickets.filter((t) => t.wave === 0).length;
  return (
    <div className="sticky bottom-4 z-10 rounded-xl border border-tone-warn-line bg-raised p-4 shadow-popover">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-tone-warn-fill text-ink-warn">
          <UserCheck className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1 basis-80">
          <h3 className="text-md font-medium text-ink">Your call</h3>
          <p className="text-pretty text-sm text-ink-secondary">
            Approve to {i.settings.autoExecute ? `start building ${firstWave} ticket${firstWave === 1 ? '' : 's'} in the first wave` : 'unlock the tickets'}, or tell the planner what to change. Tickets
            can still be edited before they start.
          </p>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Optional note, or the changes you want: what is good, what to change, what not to touch…"
            className="mt-3 min-h-[3.5rem]"
            aria-label="Note or requested changes"
          />
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" disabled={text.trim().length < 3} title={text.trim().length < 3 ? 'Write what should change first' : undefined} loading={change.isPending} onClick={() => change.mutate()} icon={<RotateCcw />}>
              Request changes
            </Button>
            <Button variant="primary" loading={approve.isPending} onClick={() => approve.mutate()} icon={<Check />}>
              {i.settings.autoExecute ? 'Approve and build' : 'Approve the plan'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
