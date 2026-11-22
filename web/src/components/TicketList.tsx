import { useMutation } from '@tanstack/react-query';
import {
  AlertOctagon,
  CheckCheck,
  ChevronRight,
  Copy,
  Eye,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Hammer,
  ListChecks,
  MessageCircleQuestion,
  MoreHorizontal,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  Send,
  ShieldCheck,
  Undo2,
  Wrench,
} from 'lucide-react';
import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { PR_SWEEP_CLAIM_MINUTES, type InitiativeDetail, type Run, type Ticket } from '@factory/shared';
import { api, type BulkAction, type TicketAction } from '@/lib/api';
import { useNow } from '@/lib/live';
import { runKind, isRunInFlight } from '@/lib/status';
import { copyWithToast, toastError } from '@/lib/toasts';
import { ago, cn, copy, money, pad2, runDuration, shortPath } from '@/lib/utils';
import { Markdown } from './Markdown';
import { RunPill, TicketPill, VerdictPill } from './StatusPill';
import { useRunDrawer } from './RunDrawer';
import { Button, Card, CardHeader, Chip, Dialog, EmptyState, Field, Input, Menu, MenuItem, MenuLabel, MenuSeparator, SegmentedBar, Textarea, Tooltip } from './ui';

const ACTIVE = new Set(['building', 'checking', 'in_review', 'fixing']);

function useExpanded(initiativeId: string) {
  const key = `factory:expanded:${initiativeId}`;
  const [set, setSet] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) ?? '[]'));
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify([...set]));
    } catch {
      return;
    }
  }, [key, set]);
  const toggle = (id: string) =>
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return { has: (id: string) => set.has(id), toggle, setAll: (ids: string[]) => setSet(new Set(ids)) };
}

export function TicketList({ detail }: { detail: InitiativeDetail }) {
  const { initiative: i, tickets, runs } = detail;
  const expanded = useExpanded(i.id);
  const approved = !!i.approvedAt;
  const bulk = useMutation({
    mutationFn: (a: BulkAction) => api.bulk(i.id, a),
    onSuccess: (r, a) =>
      toast.success(
        a === 'sync-prs' ? `Synced PRs (${r.count} changed)` : r.count ? `Queued ${r.count} agent${r.count > 1 ? 's' : ''}` : 'Nothing to do right now',
      ),
    onError: toastError,
  });
  const counts = (s: string[]) => tickets.filter((t) => s.includes(t.status)).length;
  const hasPrs = tickets.some((t) => t.prNumber);
  const hasBranches = tickets.some((t) => t.branch);

  return (
    <Card>
      <CardHeader
        icon={<ListChecks className="h-3.5 w-3.5" />}
        title="Tickets"
        sub={
          tickets.length
            ? `${counts(['approved', 'merged'])}/${tickets.length} approved · ${counts(['building', 'checking', 'in_review', 'fixing'])} in flight · each runs in a fresh agent + its own worktree`
            : undefined
        }
        right={
          approved && tickets.length ? (
            <>
              <Button size="sm" variant="ghost" icon={<Play className="h-3.5 w-3.5" />} onClick={() => bulk.mutate('run-ready')} disabled={bulk.isPending}>
                Run ready
              </Button>
              <Button size="sm" variant="ghost" icon={<ScanSearch className="h-3.5 w-3.5" />} onClick={() => bulk.mutate('review-all')} disabled={bulk.isPending || !hasBranches}>
                Review all
              </Button>
              <Button size="sm" variant="ghost" icon={<Wrench className="h-3.5 w-3.5" />} onClick={() => bulk.mutate('fix-all')} disabled={bulk.isPending || !hasBranches}>
                Fix all PRs
              </Button>
              <Tooltip content="Pull PR state from GitHub (merged PRs unblock dependents)">
                <Button size="sm" variant="ghost" icon={<RefreshCw className={cn('h-3.5 w-3.5', bulk.isPending && bulk.variables === 'sync-prs' && 'animate-spin')} />} onClick={() => bulk.mutate('sync-prs')} disabled={bulk.isPending || !hasPrs}>
                  Sync PRs
                </Button>
              </Tooltip>
            </>
          ) : null
        }
      />
      {tickets.length > 0 && (
        <div className="border-b border-line px-4 py-2">
          <SegmentedBar
            segments={[
              { value: counts(['merged']), tone: 'success', label: 'Merged' },
              { value: counts(['approved']), tone: 'success', label: 'Approved' },
              { value: counts(['built']), tone: 'info', label: 'Built' },
              { value: counts(['building', 'checking', 'in_review', 'fixing']), tone: 'active', label: 'In flight' },
              { value: counts(['changes_requested']), tone: 'attention', label: 'Changes requested' },
              { value: counts(['blocked']), tone: 'danger', label: 'Needs you' },
              { value: counts(['todo', 'proposed']), tone: 'muted', label: 'Not started' },
            ]}
          />
        </div>
      )}
      {tickets.length === 0 ? (
        <EmptyState icon={<ListChecks />} title="No tickets yet">
          Tickets appear here once the planner finishes. You review the overview first, then approve.
        </EmptyState>
      ) : (
        <div className="divide-y divide-line">
          <div className="grid grid-cols-[20px_34px_1fr_auto] items-center gap-3 px-4 py-1.5 text-2xs uppercase tracking-wider text-zinc-600 md:grid-cols-[20px_34px_1fr_130px_auto] lg:grid-cols-[20px_34px_1fr_130px_110px_70px_auto]">
            <span />
            <span>#</span>
            <span>Ticket</span>
            <span className="hidden md:block">Status</span>
            <span className="hidden lg:block">Last verdict</span>
            <span className="hidden text-right lg:block">Cost</span>
            <span />
          </div>
          {tickets.map((t) => (
            <TicketRow
              key={t.id}
              ticket={t}
              all={tickets}
              runs={runs.filter((r) => r.ticketId === t.id)}
              open={expanded.has(t.id)}
              onToggle={() => expanded.toggle(t.id)}
              initiativeId={i.id}
              approved={approved}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function TicketRow({
  ticket: t,
  all,
  runs,
  open,
  onToggle,
  initiativeId,
  approved,
}: {
  ticket: Ticket;
  all: Ticket[];
  runs: Run[];
  open: boolean;
  onToggle: () => void;
  initiativeId: string;
  approved: boolean;
}) {
  const drawer = useRunDrawer();
  const [editing, setEditing] = useState(false);
  const activeRun = runs.find(isRunInFlight);
  const cost = runs.reduce((a, r) => a + (r.costUsd ?? 0), 0);
  const deps = t.dependsOn.map((k) => all.find((x) => x.key === k)).filter(Boolean) as Ticket[];
  const waitingOn = deps.filter((d) => !['approved', 'merged'].includes(d.status) && !d.branch);
  const act = useMutation({
    mutationFn: (a: TicketAction) => api.ticketAction(t.id, a),
    onSuccess: (_r, a) => {
      const msg: Record<TicketAction, string> = {
        run: 'Executor queued',
        check: 'Checks queued',
        review: 'Reviewer queued',
        fix: 'Fixer queued',
        reset: 'Ticket reset',
        'mark-approved': 'Marked approved',
        'mark-merged': 'Marked merged',
        'mark-todo': 'Moved back to to-do',
      };
      toast.success(msg[a]);
    },
    onError: toastError,
  });

  const primary = (() => {
    if (activeRun) return { label: 'Watch', icon: <Eye className="h-3.5 w-3.5" />, onClick: () => drawer.open(activeRun.id), variant: 'outline' as const };
    if (!approved) return null;
    switch (t.status) {
      case 'todo':
        if (waitingOn.length) return null;
        return { label: 'Run', icon: <Play className="h-3.5 w-3.5" />, onClick: () => act.mutate('run'), variant: 'secondary' as const };
      case 'built':
        return { label: 'Review', icon: <ScanSearch className="h-3.5 w-3.5" />, onClick: () => act.mutate('review'), variant: 'secondary' as const };
      case 'changes_requested':
        return { label: 'Fix', icon: <Wrench className="h-3.5 w-3.5" />, onClick: () => act.mutate('fix'), variant: 'secondary' as const };
      case 'blocked':
        if (t.branch && t.gateStatus === 'fail')
          return { label: 'Re-check', icon: <ShieldCheck className="h-3.5 w-3.5" />, onClick: () => act.mutate('check'), variant: 'secondary' as const };
        return t.branch
          ? { label: 'Fix', icon: <Wrench className="h-3.5 w-3.5" />, onClick: () => act.mutate('fix'), variant: 'secondary' as const }
          : { label: 'Retry', icon: <Play className="h-3.5 w-3.5" />, onClick: () => act.mutate('run'), variant: 'secondary' as const };
      default:
        return null;
    }
  })();

  const editable = ['proposed', 'todo', 'blocked'].includes(t.status) && !t.branch;

  return (
    <div className={cn('transition-colors', open ? 'bg-white/[0.015]' : 'hover:bg-white/[0.02]')}>
      <div className="grid cursor-pointer grid-cols-[20px_34px_1fr_auto] items-center gap-3 px-4 py-2.5 md:grid-cols-[20px_34px_1fr_130px_auto] lg:grid-cols-[20px_34px_1fr_130px_110px_70px_auto]" onClick={onToggle}>
        <ChevronRight className={cn('h-3.5 w-3.5 text-zinc-600 transition-transform', open && 'rotate-90 text-zinc-400')} />
        <span className={cn('font-mono text-xs tabular-nums', ACTIVE.has(t.status) ? 'text-cyan-300' : 'text-zinc-500')}>{pad2(t.seq)}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="line-clamp-2 text-[13px] font-medium leading-snug text-zinc-100">{t.title}</span>
            {t.size && <span className="shrink-0 rounded border border-line px-1 font-mono text-[10px] text-zinc-500">{t.size}</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-2xs text-zinc-500">
            {deps.length > 0 && <span>after {deps.map((d) => pad2(d.seq)).join(', ')}</span>}
            {t.round > 1 && <span>round {t.round}</span>}
            {t.prUrl && (
              <a href={t.prUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-violet-300 hover:text-violet-200">
                <GitPullRequest className="h-3 w-3" />#{t.prNumber}
                {t.prState && t.prState !== 'OPEN' && <span className="text-zinc-500">({t.prState.toLowerCase()})</span>}
              </a>
            )}
            {t.prSweepClaimedAt && (
              <Tooltip content={`The PR sweep started fixing this PR ${ago(t.prSweepClaimedAt)}. The mark clears when the fix finishes, or after ${PR_SWEEP_CLAIM_MINUTES} minutes.`}>
                <span className="inline-flex items-center gap-1 text-cyan-300">
                  <RefreshCw className="h-3 w-3 animate-spin [animation-duration:2.5s]" />
                  sweep fixing
                </span>
              </Tooltip>
            )}
            {t.branch && !t.prUrl && (
              <span className="inline-flex min-w-0 items-center gap-1 font-mono">
                <GitBranch className="h-3 w-3 shrink-0" />
                <span className="truncate">{t.branch}</span>
              </span>
            )}
            <span className="md:hidden">
              <TicketPill status={t.status} />
            </span>
          </div>
        </div>
        <span className="hidden md:block">
          <TicketPill status={t.status} />
        </span>
        <span className="hidden lg:block">{t.lastVerdict ? <VerdictPill verdict={t.lastVerdict} /> : t.gateStatus === 'fail' ? <VerdictPill verdict="GATE: FAIL" /> : <span className="text-2xs text-zinc-700">—</span>}</span>
        <span className="hidden text-right font-mono text-2xs tabular-nums text-zinc-500 lg:block">{cost ? money(cost) : '—'}</span>
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {!primary && t.status === 'todo' && waitingOn.length > 0 && (
            <Tooltip content={`Starts when ${waitingOn.map((d) => pad2(d.seq)).join(', ')} ${waitingOn.length > 1 ? 'are' : 'is'} approved`}>
              <span className="hidden whitespace-nowrap text-2xs text-zinc-600 sm:inline">waiting on {waitingOn.map((d) => pad2(d.seq)).join(', ')}</span>
            </Tooltip>
          )}
          {primary && (
            <Button size="sm" variant={primary.variant} icon={primary.icon} onClick={primary.onClick} loading={act.isPending}>
              {primary.label}
            </Button>
          )}
          <Menu
            trigger={
              <Button size="sm" variant="ghost" className="w-7 px-0" aria-label="Ticket actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            }
          >
            <MenuLabel>Agents (fresh context)</MenuLabel>
            <MenuItem icon={<Hammer />} disabled={!approved || !!activeRun || t.status === 'merged' || waitingOn.length > 0} onSelect={() => act.mutate('run')} hint="opus">
              {t.branch ? 'Continue build' : 'Build'}
            </MenuItem>
            <MenuItem icon={<ShieldCheck />} disabled={!t.branch || !!activeRun} onSelect={() => act.mutate('check')} hint="no agent">
              Run checks
            </MenuItem>
            <MenuItem icon={<ScanSearch />} disabled={!t.branch || !!activeRun} onSelect={() => act.mutate('review')}>
              Review branch
            </MenuItem>
            <MenuItem icon={<Wrench />} disabled={!t.branch || !!activeRun} onSelect={() => act.mutate('fix')}>
              Fix (review, checks, PR comments)
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<CheckCheck />} disabled={!approved || t.status === 'approved'} onSelect={() => act.mutate('mark-approved')}>
              Mark approved
            </MenuItem>
            <MenuItem icon={<GitMerge />} disabled={!approved || t.status === 'merged'} onSelect={() => act.mutate('mark-merged')}>
              Mark merged
            </MenuItem>
            <MenuItem icon={<Undo2 />} disabled={!approved || t.status === 'todo' || !!activeRun} onSelect={() => act.mutate('mark-todo')}>
              Back to to-do
            </MenuItem>
            {editable && (
              <MenuItem icon={<Pencil />} onSelect={() => setEditing(true)}>
                Edit ticket
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem
              icon={<RotateCcw />}
              danger
              disabled={!t.branch && !activeRun}
              onSelect={() => {
                if (confirm(`Reset ${pad2(t.seq)}? This stops its agents and deletes its local worktree and branch. Pushed branches and PRs stay.`)) act.mutate('reset');
              }}
            >
              Reset ticket
            </MenuItem>
          </Menu>
        </div>
      </div>
      {open && <TicketDetail ticket={t} runs={runs} initiativeId={initiativeId} />}
      <EditTicketDialog ticket={t} open={editing} onOpenChange={setEditing} />
    </div>
  );
}

function TicketDetail({ ticket: t, runs, initiativeId }: { ticket: Ticket; runs: Run[]; initiativeId: string }) {
  const latestOutput = runs.find((r) => r.status === 'succeeded' && r.outputMd && r.kind !== 'gate') ?? runs.find((r) => r.outputMd);
  return (
    <div className="animate-fade-in space-y-4 border-t border-line/60 px-4 pb-4 pl-[66px] pt-3">
      {t.status === 'blocked' && t.blockedReason && (
        <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2.5 text-xs text-rose-100">
          <AlertOctagon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300" />
          <div className="min-w-0">
            <div className="font-medium">Needs you</div>
            <Markdown tight className="mt-1 text-rose-100/80">{t.blockedReason}</Markdown>
          </div>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <dl className="space-y-2.5">
          {[
            ['What happens', t.what],
            ['Goal', t.goal],
            ['Measurable outcome', t.outcome],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="section-title">{k}</dt>
              <dd className="mt-0.5 text-xs leading-relaxed text-zinc-300">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="space-y-3">
          <div>
            <div className="section-title">Acceptance checks</div>
            <ol className="mt-1 space-y-1">
              {t.acceptance.map((a, n) => (
                <li key={n} className="flex gap-2 text-xs leading-relaxed text-zinc-300">
                  <span className="font-mono text-2xs text-zinc-600">{n + 1}.</span>
                  {a}
                </li>
              ))}
            </ol>
          </div>
          <div>
            <div className="section-title">Guidance for the agent</div>
            <ul className="mt-1 space-y-1">
              {t.guidance.map((g, n) => (
                <li key={n} className="flex gap-2 text-xs leading-relaxed text-zinc-400">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
                  {g}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {(t.branch || t.worktreePath) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {t.branch && <CopyChip icon={<GitBranch className="h-3 w-3" />} value={t.branch} />}
          {t.baseRef && <Chip>base {t.baseRef}</Chip>}
          {t.worktreePath && <CopyChip value={t.worktreePath} display={shortPath(t.worktreePath)} />}
        </div>
      )}

      {runs.length > 0 && <RunTimeline runs={runs} />}

      {latestOutput?.outputMd && (
        <div className="rounded-xl border border-line bg-black/20">
          <div className="flex items-center gap-2 border-b border-line px-3.5 py-2 text-2xs text-zinc-500">
            Latest output · {runKind[latestOutput.kind].agent} round {latestOutput.round} <VerdictPill verdict={latestOutput.verdict} />
          </div>
          <div className="max-h-[360px] overflow-y-auto px-4 py-3">
            <Markdown>{latestOutput.outputMd.split('\n').slice(1).join('\n')}</Markdown>
          </div>
        </div>
      )}

      <TicketComposer ticket={t} initiativeId={initiativeId} />
    </div>
  );
}

function CopyChip({ value, display, icon }: { value: string; display?: string; icon?: ReactNode }) {
  return (
    <button onClick={() => copyWithToast(value)} className="mono-chip hover:border-line-strong hover:text-zinc-200" title={value}>
      {icon}
      <span className="max-w-[340px] truncate">{display ?? value}</span>
      <Copy className="h-2.5 w-2.5 opacity-60" />
    </button>
  );
}

function RunTimeline({ runs }: { runs: Run[] }) {
  const drawer = useRunDrawer();
  const now = useNow(1000, runs.some((r) => r.status === 'running'));
  return (
    <div>
      <div className="section-title mb-1.5">Agent runs</div>
      <ol className="relative space-y-1 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-line">
        {runs.map((r) => {
          const k = runKind[r.kind];
          return (
            <li key={r.id}>
              <button onClick={() => drawer.open(r.id)} className="group relative flex w-full items-center gap-3 rounded-lg px-0 py-1 text-left">
                <span className={cn('relative z-10 grid h-6 w-6 place-items-center rounded-full border border-line bg-surface', k.color)}>
                  <k.icon className="h-3 w-3" />
                </span>
                <span className="w-24 text-xs text-zinc-300 group-hover:text-white">
                  {k.agent}
                  {r.round > 0 && r.kind !== 'gate' && <span className="text-zinc-600"> · R{r.round}</span>}
                </span>
                <RunPill status={r.status} />
                <VerdictPill verdict={r.verdict} />
                <span className="ml-auto flex items-center gap-3 font-mono text-2xs tabular-nums text-zinc-500">
                  {r.model && <span className="hidden sm:inline">{r.model}</span>}
                  <span>{runDuration(r, now)}</span>
                  <span className="w-12 text-right">{money(r.costUsd)}</span>
                  <span className="w-16 text-right">{ago(r.queuedAt, now)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TicketComposer({ ticket: t, initiativeId }: { ticket: Ticket; initiativeId: string }) {
  const [text, setText] = useState('');
  const send = useMutation({
    mutationFn: (kind: 'feedback' | 'question') => api.message(initiativeId, { body: text, kind, ticketId: t.id, act: true }),
    onSuccess: (_r, kind) => {
      setText('');
      toast.success(kind === 'question' ? 'Asked — the answer appears in Activity' : t.branch ? 'Feedback sent — a fresh fixer is starting' : 'Feedback saved — a fresh executor is starting');
    },
    onError: toastError,
  });
  if (['proposed'].includes(t.status)) return null;
  return (
    <div className="rounded-xl border border-line bg-black/20 p-2.5">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t.branch ? 'Tell the fixer what to change on this branch, or ask a question about it…' : 'Add guidance for the executor, or ask a question…'}
        className="min-h-[56px] border-transparent bg-transparent focus:ring-0"
      />
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button size="sm" variant="ghost" icon={<MessageCircleQuestion className="h-3.5 w-3.5" />} disabled={!text.trim() || send.isPending} onClick={() => send.mutate('question')}>
          Ask
        </Button>
        <Button size="sm" variant="secondary" icon={<Send className="h-3.5 w-3.5" />} disabled={!text.trim() || send.isPending} onClick={() => send.mutate('feedback')}>
          {t.branch ? 'Send to fixer' : 'Send to executor'}
        </Button>
      </div>
    </div>
  );
}

function EditTicketDialog({ ticket: t, open, onOpenChange }: { ticket: Ticket; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [form, setForm] = useState({ title: t.title, what: t.what, goal: t.goal, outcome: t.outcome, guidance: t.guidance.join('\n'), acceptance: t.acceptance.join('\n') });
  useEffect(() => {
    if (open) setForm({ title: t.title, what: t.what, goal: t.goal, outcome: t.outcome, guidance: t.guidance.join('\n'), acceptance: t.acceptance.join('\n') });
  }, [open, t]);
  const save = useMutation({
    mutationFn: () =>
      api.updateTicket(t.id, {
        title: form.title,
        what: form.what,
        goal: form.goal,
        outcome: form.outcome,
        guidance: form.guidance.split('\n').map((s) => s.trim()).filter(Boolean),
        acceptance: form.acceptance.split('\n').map((s) => s.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      toast.success('Ticket saved');
      onOpenChange(false);
    },
    onError: toastError,
  });
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={`Edit ${pad2(t.seq)}`}
      description="Your edits win: the executor reads the ticket as it is when it starts."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Title">
          <Input value={form.title} onChange={set('title')} />
        </Field>
        <Field label="What happens">
          <Textarea value={form.what} onChange={set('what')} className="min-h-[60px]" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Goal">
            <Textarea value={form.goal} onChange={set('goal')} className="min-h-[60px]" />
          </Field>
          <Field label="Measurable outcome">
            <Textarea value={form.outcome} onChange={set('outcome')} className="min-h-[60px]" />
          </Field>
        </div>
        <Field label="Guidance (one per line)">
          <Textarea value={form.guidance} onChange={set('guidance')} className="min-h-[90px] font-mono text-xs" />
        </Field>
        <Field label="Acceptance checks (one per line)">
          <Textarea value={form.acceptance} onChange={set('acceptance')} className="min-h-[90px] font-mono text-xs" />
        </Field>
      </div>
    </Dialog>
  );
}
