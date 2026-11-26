import { useMutation } from '@tanstack/react-query';
import {
  AlertOctagon,
  CheckCheck,
  ChevronRight,
  Eye,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GraduationCap,
  Hammer,
  Hourglass,
  Layers,
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
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { toast } from 'sonner';
import { PR_SWEEP_CLAIM_MINUTES, overSizeBudget, type InitiativeDetail, type PrSweepSkip, type Run, type Ticket } from '@factory/shared';
import { AgentGlyph } from '@/components/AgentGlyph';
import { useRunDock } from '@/components/dock/use-run-dock';
import { Markdown } from '@/components/Markdown';
import { RunBadge, TicketBadge, VerdictBadge } from '@/components/StatusBadge';
import {
  Badge,
  Button,
  Callout,
  Card,
  Chip,
  CopyChip,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Segmented,
  SegmentedBar,
  Textarea,
  Tooltip,
  confirmAction,
} from '@/components/ui';
import { api, type BulkAction, type TicketAction } from '@/lib/api';
import { countTickets, progressSegments } from '@/lib/initiative';
import { useNow } from '@/lib/live';
import { MOD } from '@/lib/shortcuts';
import { isArbitrating, isRunInFlight, replacedRunIds, runKind } from '@/lib/status';
import { TICKET_ACTION_TOASTS, TICKET_FILTERS, dependenciesOf, primaryTicketAction, sweepSkipLabel, sweepSkipOf, ticketFilterOf, type TicketFilter } from '@/lib/tickets';
import { toastError } from '@/lib/toasts';
import { ago, cn, money, pad2, runDuration, shortPath } from '@/lib/utils';

const CI_BADGES = {
  green: { label: 'CI green', tone: 'good' },
  red: { label: 'CI red', tone: 'bad' },
  pending: { label: 'CI running', tone: 'active' },
} as const;

const BULK_TOASTS: Record<BulkAction, (n: number) => string> = {
  'run-ready': (n) => (n ? `Queued ${n} executor${n > 1 ? 's' : ''}` : 'No ticket is ready to build right now'),
  'review-all': (n) => (n ? `Queued ${n} reviewer${n > 1 ? 's' : ''}` : 'Nothing to review right now'),
  'fix-all': (n) => (n ? `Queued ${n} fixer${n > 1 ? 's' : ''}` : 'Nothing to fix right now'),
  'fix-prs': (n) => (n ? `Started a fixer on ${n} PR${n > 1 ? 's' : ''}` : 'No open PR has anything to fix right now'),
  'sync-prs': (n) => `Synced the PRs (${n} changed)`,
  'ready-prs': (n) => (n ? `Marked ${n} PR${n > 1 ? 's' : ''} ready for review` : 'No draft PR left'),
};

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
  const openAll = (ids: string[]) => setSet((prev) => (ids.every((id) => prev.has(id)) ? prev : new Set([...prev, ...ids])));
  return { has: (id: string) => set.has(id), toggle, openAll };
}

const ACTION_ICONS: Record<TicketAction, typeof Play> = {
  run: Play,
  check: ShieldCheck,
  review: ScanSearch,
  fix: Wrench,
  retro: GraduationCap,
  reset: RotateCcw,
  'mark-approved': CheckCheck,
  'mark-merged': GitMerge,
  'mark-todo': Undo2,
};

export function TicketList({ detail, show, onShow }: { detail: InitiativeDetail; show: TicketFilter; onShow: (f: TicketFilter) => void }) {
  const { initiative: i, tickets, runs } = detail;
  const expanded = useExpanded(i.id);
  const approved = !!i.approvedAt;
  const bulk = useMutation({ mutationFn: (a: BulkAction) => api.bulk(i.id, a), onSuccess: (r, a) => toast.success(BULK_TOASTS[a](r.count)), onError: toastError });
  const live = tickets.filter((t) => t.status !== 'canceled');
  const runsOf = (t: Ticket) => runs.filter((r) => r.ticketId === t.id);
  const filterOf = useMemo(() => new Map(tickets.map((t) => [t.id, ticketFilterOf(t, runsOf(t))])), [tickets, runs]);
  const perFilter = (f: TicketFilter) => (f === 'all' ? live.length : tickets.filter((t) => filterOf.get(t.id) === f).length);
  const shown = show === 'all' ? live : tickets.filter((t) => filterOf.get(t.id) === show);
  const filters = TICKET_FILTERS.filter((f) => f.value !== 'canceled' || perFilter('canceled') > 0 || show === 'canceled');
  const arbitrated = tickets.filter((t) => t.status === 'blocked' && isArbitrating(runsOf(t))).length;
  const hasPrs = tickets.some((t) => t.prNumber);
  const hasBranches = tickets.some((t) => t.branch);
  const counts = countTickets(live);
  const needsYouIds = live.filter((t) => filterOf.get(t.id) === 'needs-you').map((t) => t.id);
  useEffect(() => {
    if (show === 'needs-you') expanded.openAll(needsYouIds);
  }, [show, needsYouIds.join()]);

  if (tickets.length === 0) {
    return (
      <Card>
        <EmptyState icon={<ListChecks />} title="No tickets yet">
          {i.kind === 'open-prs'
            ? 'Open pull requests you opened in this repository show up here once the PR sweep adopts them.'
            : 'Tickets appear once the planner finishes. You review the plan first, then approve it, and agents start building.'}
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-subtle px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-medium text-ink">Tickets</h2>
          <p className="text-xs text-ink-tertiary">Each ticket is built by a fresh agent on its own branch and worktree.</p>
        </div>
        {approved && (
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" variant="ghost" icon={<Play />} onClick={() => bulk.mutate('run-ready')} disabled={bulk.isPending} title="Build every ticket whose dependencies are ready">
              Build ready
            </Button>
            <Button size="sm" variant="ghost" icon={<ScanSearch />} onClick={() => bulk.mutate('review-all')} disabled={bulk.isPending || !hasBranches} title="Review every built branch">
              Review all
            </Button>
            <Button size="sm" variant="ghost" icon={<Wrench />} onClick={() => bulk.mutate('fix-all')} disabled={bulk.isPending || !hasBranches} title="Fix every branch with findings">
              Fix all
            </Button>
            <Tooltip content="Pull PR state from GitHub. Merged PRs unblock the tickets that depend on them.">
              <Button size="sm" variant="ghost" icon={<RefreshCw className={cn(bulk.isPending && bulk.variables === 'sync-prs' && 'animate-spin')} />} onClick={() => bulk.mutate('sync-prs')} disabled={bulk.isPending || !hasPrs}>
                Sync PRs
              </Button>
            </Tooltip>
          </div>
        )}
      </div>
      <div className="space-y-3 border-b border-line-subtle px-4 py-3">
        <SegmentedBar segments={progressSegments(counts, arbitrated)} legend />
        <Segmented
          size="xs"
          label="Show tickets"
          value={show}
          onChange={onShow}
          options={filters.map((f) => ({ value: f.value, label: `${f.label} ${perFilter(f.value)}` }))}
        />
      </div>
      {shown.length === 0 ? (
        <EmptyState title={show === 'needs-you' ? 'No ticket needs you' : 'No ticket here'} className="py-10">
          {show === 'needs-you' ? 'Every ticket is either moving or done.' : 'Pick another filter above to see the rest.'}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line-subtle">
          {shown.map((t) => (
            <TicketRow
              key={t.id}
              ticket={t}
              all={tickets}
              runs={runsOf(t)}
              open={expanded.has(t.id)}
              onToggle={() => expanded.toggle(t.id)}
              initiativeId={i.id}
              approved={approved}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function TicketRow({ ticket: t, all, runs, open, onToggle, initiativeId, approved }: { ticket: Ticket; all: Ticket[]; runs: Run[]; open: boolean; onToggle: () => void; initiativeId: string; approved: boolean }) {
  const dock = useRunDock();
  const [editing, setEditing] = useState(false);
  const activeRun = runs.find(isRunInFlight);
  const arbitrating = isArbitrating(runs);
  const sweepSkip = sweepSkipOf(t, activeRun);
  const cost = runs.reduce((a, r) => a + (r.costUsd ?? 0), 0);
  const { deps, waitingOn } = dependenciesOf(t, all);
  const stackedOn = all.find((x) => x.prNumber && (x.prHeadRef ?? x.branch) === t.baseRef);
  const act = useMutation({ mutationFn: (a: TicketAction) => api.ticketAction(t.id, a), onSuccess: (_r, a) => toast.success(TICKET_ACTION_TOASTS[a]), onError: toastError });
  const primary = primaryTicketAction(t, { approved, activeRun, waitingOn });
  const PrimaryIcon = primary?.kind === 'act' ? ACTION_ICONS[primary.action] : Eye;
  const editable = ['proposed', 'todo', 'blocked'].includes(t.status) && !t.branch;
  const live = !!activeRun && activeRun.status === 'running';
  const reset = async () => {
    const ok = await confirmAction({
      title: `Reset ticket ${pad2(t.seq)}?`,
      description: 'This stops its agents and deletes its local worktree and branch. Pushed branches and pull requests stay.',
      confirmLabel: 'Reset ticket',
      danger: true,
    });
    if (ok) act.mutate('reset');
  };

  return (
    <li className={cn('transition-colors', open ? 'bg-sunken/40' : 'hover:bg-hover', t.status === 'canceled' && 'opacity-60')}>
      <div className="flex items-start gap-3 px-4 py-3">
        <button type="button" onClick={onToggle} aria-expanded={open} aria-label={open ? `Hide ticket ${pad2(t.seq)}` : `Show ticket ${pad2(t.seq)}`} className="flex min-w-0 flex-1 items-start gap-3 text-left">
          <ChevronRight className={cn('mt-0.5 size-4 shrink-0 text-ink-tertiary transition-transform duration-hover', open && 'rotate-90')} />
          <span className={cn('numeric mt-px w-6 shrink-0 text-sm', live ? 'text-ink-alert' : 'text-ink-tertiary')}>{pad2(t.seq)}</span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-pretty text-sm font-medium leading-snug text-ink">{t.title}</span>
              {t.size && <span className="rounded-xs border border-line px-1 font-mono text-2xs text-ink-tertiary">{t.size}</span>}
              {t.linesChanged != null && (
                <Tooltip content="Lines changed outside tests, lockfiles and generated files">
                  <span className={cn('numeric text-2xs', overSizeBudget(t.size, t.linesChanged) ? 'text-ink-warn' : 'text-ink-tertiary')}>
                    {t.linesChanged} lines{overSizeBudget(t.size, t.linesChanged) && ' · over budget'}
                  </span>
                </Tooltip>
              )}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-tertiary">
              {deps.length > 0 && <span>After {deps.map((d) => pad2(d.seq)).join(', ')}</span>}
              {t.round > 1 && <span>Round {t.round}</span>}
              {t.prUrl && (
                <a href={t.prUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 font-medium text-ink-accent hover:underline">
                  <GitPullRequest className="size-3.5" />#{t.prNumber}
                  {t.prState && t.prState !== 'OPEN' && <span className="font-normal text-ink-tertiary">({t.prState.toLowerCase()})</span>}
                </a>
              )}
              {(t.ciState === 'green' || t.ciState === 'red' || t.ciState === 'pending') && (
                <Badge tone={CI_BADGES[t.ciState].tone} dot live={t.ciState === 'pending'}>
                  {CI_BADGES[t.ciState].label}
                </Badge>
              )}
              {t.prStack && (
                <Tooltip content={stackedOn ? `Stacked PR on GitHub, on top of #${stackedOn.prNumber}` : 'Bottom of a stacked PR on GitHub'}>
                  <span className="inline-flex items-center gap-1">
                    <Layers className="size-3.5" /> stacked
                  </span>
                </Tooltip>
              )}
              {t.prSweepClaimedAt && (
                <Tooltip content={`The PR sweep started fixing this PR ${ago(t.prSweepClaimedAt)}. The mark clears when the fix finishes, or after ${PR_SWEEP_CLAIM_MINUTES} minutes.`}>
                  <span className="inline-flex items-center gap-1 text-ink-alert">
                    <RefreshCw className="size-3.5 animate-spin [animation-duration:2.5s]" /> sweep fixing
                  </span>
                </Tooltip>
              )}
              {sweepSkip && (
                <Tooltip content={`${sweepSkip.why}${sweepSkip.waitingOn.length ? ` Waiting on ${sweepSkip.waitingOn.join('; ')}.` : ''}`}>
                  <span className={cn('inline-flex items-center gap-1 whitespace-nowrap', sweepSkip.reason === 'already-tried' && 'text-ink-warn')}>
                    <Hourglass className="size-3.5" /> {sweepSkipLabel(sweepSkip)}
                  </span>
                </Tooltip>
              )}
              {t.branch && !t.prUrl && (
                <span className="inline-flex min-w-0 items-center gap-1 font-mono">
                  <GitBranch className="size-3.5 shrink-0" />
                  <span className="truncate">{t.branch}</span>
                </span>
              )}
              {!primary && t.status === 'todo' && waitingOn.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Hourglass className="size-3.5" /> Starts when {waitingOn.map((d) => pad2(d.seq)).join(', ')} {waitingOn.length > 1 ? 'are' : 'is'} built
                </span>
              )}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1.5 @md:flex-row @md:items-center @md:gap-3">
          <div className="flex items-center gap-1.5">
            <TicketBadge status={t.status} arbitrating={arbitrating} />
            <span className="hidden @lg:inline-flex">
              {t.lastVerdict ? (
                <VerdictBadge verdict={t.lastVerdict} />
              ) : t.gateStatus === 'fail' ? (
                <VerdictBadge verdict="GATE: FAIL" />
              ) : t.gateStatus === 'waiting' ? (
                <VerdictBadge verdict="GATE: WAITING" />
              ) : null}
            </span>
          </div>
          <span className="numeric hidden w-14 text-right text-xs text-ink-tertiary @lg:block">{cost ? money(cost) : ''}</span>
          <div className="flex items-center gap-1">
            {primary && (
              <Button
                size="sm"
                variant={primary.kind === 'watch' ? 'outline' : t.status === 'blocked' ? 'primary' : 'secondary'}
                icon={<PrimaryIcon />}
                onClick={() => (primary.kind === 'watch' ? dock.watch(primary.runId) : act.mutate(primary.action))}
                loading={act.isPending}
              >
                {primary.label}
              </Button>
            )}
            <Menu trigger={<IconButton label="Ticket actions" icon={<MoreHorizontal />} />}>
              <MenuLabel>Start a fresh agent</MenuLabel>
              <MenuItem icon={<Hammer />} disabled={!approved || !!activeRun || t.status === 'merged' || waitingOn.length > 0} onSelect={() => act.mutate('run')} description="Writes the code on the ticket's branch">
                {t.branch ? 'Continue the build' : 'Build'}
              </MenuItem>
              <MenuItem icon={<ShieldCheck />} disabled={!t.branch || !!activeRun} onSelect={() => act.mutate('check')} description="The project's checks command, no agent">
                Run checks
              </MenuItem>
              <MenuItem icon={<ScanSearch />} disabled={!t.branch || !!activeRun} onSelect={() => act.mutate('review')}>
                Review the branch
              </MenuItem>
              <MenuItem icon={<Wrench />} disabled={!t.branch || !!activeRun} onSelect={() => act.mutate('fix')} description="Review findings, failing checks, PR comments">
                Fix
              </MenuItem>
              <MenuItem icon={<GraduationCap />} disabled={!t.branch} onSelect={() => act.mutate('retro')} description="Learn rules from how you steered it">
                Retro
              </MenuItem>
              <MenuSeparator />
              <MenuLabel>Set the status by hand</MenuLabel>
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
                  Edit the ticket
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem icon={<RotateCcw />} danger disabled={!t.branch && !activeRun} onSelect={reset} description="Deletes its local worktree and branch">
                Reset the ticket
              </MenuItem>
            </Menu>
          </div>
        </div>
      </div>
      {open && <TicketDetail ticket={t} runs={runs} initiativeId={initiativeId} />}
      <EditTicketDialog ticket={t} open={editing} onOpenChange={setEditing} />
    </li>
  );
}

function SweepSkipPanel({ skip }: { skip: PrSweepSkip }) {
  return (
    <Callout tone="neutral" icon={<Hourglass />} title={`The PR sweep left this PR alone · ${skip.headSha.slice(0, 7)} · since ${ago(skip.since).replace(/ ago$/, '')}`}>
      <p>{skip.why}</p>
      {skip.waitingOn.length > 0 && (
        <div className="mt-2">
          <div className="eyebrow">Waiting on people or external work</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {skip.waitingOn.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {skip.ignored.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-ink-tertiary hover:text-ink">
            Ignored {skip.ignored.length} item{skip.ignored.length > 1 ? 's' : ''} a fixer can't act on
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 break-words pl-4 text-xs">
            {skip.ignored.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </Callout>
  );
}

function TicketDetail({ ticket: t, runs, initiativeId }: { ticket: Ticket; runs: Run[]; initiativeId: string }) {
  const latestOutput = runs.find((r) => r.status === 'succeeded' && r.outputMd && r.kind !== 'gate') ?? runs.find((r) => r.outputMd);
  const arbitrating = isArbitrating(runs);
  const sweepSkip = sweepSkipOf(t, runs.find(isRunInFlight));
  return (
    <div className="animate-fade-in space-y-4 px-4 pb-4 pl-[3.6rem]">
      {sweepSkip && <SweepSkipPanel skip={sweepSkip} />}
      {t.status === 'blocked' && t.blockedReason && (
        <Callout tone={arbitrating ? 'active' : 'bad'} icon={<AlertOctagon />} title={arbitrating ? 'It stopped, and the arbiter is deciding for you' : 'Why it needs you'}>
          <Markdown tight>{t.blockedReason}</Markdown>
        </Callout>
      )}
      <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2">
        <dl className="space-y-3">
          {[
            ['What happens', t.what],
            ['Goal', t.goal],
            ['Measurable outcome', t.outcome],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="eyebrow">{k}</dt>
              <dd className="mt-1 text-pretty text-sm leading-relaxed text-ink-secondary">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="space-y-3">
          <div>
            <div className="eyebrow">Acceptance checks</div>
            <ol className="mt-1 space-y-1">
              {t.acceptance.map((a, n) => (
                <li key={n} className="flex gap-2 text-sm leading-relaxed text-ink-secondary">
                  <span className="numeric text-xs text-ink-tertiary">{n + 1}.</span>
                  {a}
                </li>
              ))}
            </ol>
          </div>
          {t.guidance.length > 0 && (
            <div>
              <div className="eyebrow">Guidance for the agent</div>
              <ul className="mt-1 space-y-1">
                {t.guidance.map((g, n) => (
                  <li key={n} className="flex gap-2 text-sm leading-relaxed text-ink-secondary">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-ink-tertiary" />
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      {(t.branch || t.worktreePath) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {t.branch && <CopyChip icon={<GitBranch />} value={t.branch} label="Branch name copied" />}
          {t.baseRef && <Chip mono>base {t.baseRef}</Chip>}
          {t.worktreePath && <CopyChip value={t.worktreePath} display={shortPath(t.worktreePath)} label="Worktree path copied" />}
        </div>
      )}
      {runs.length > 0 && <RunTimeline runs={runs} />}
      {latestOutput?.outputMd && (
        <div className="overflow-hidden rounded-lg border border-line-subtle">
          <div className="flex items-center gap-2 border-b border-line-subtle bg-sunken px-3.5 py-2 text-xs text-ink-secondary">
            Latest output · {runKind[latestOutput.kind].agent}, round {latestOutput.round} <VerdictBadge verdict={latestOutput.verdict} />
          </div>
          <div className="max-h-[22rem] overflow-y-auto px-4 py-3">
            <Markdown>{latestOutput.outputMd.split('\n').slice(1).join('\n')}</Markdown>
          </div>
        </div>
      )}
      <TicketComposer ticket={t} initiativeId={initiativeId} />
    </div>
  );
}

function RunTimeline({ runs }: { runs: Run[] }) {
  const dock = useRunDock();
  const now = useNow(1000, runs.some((r) => r.status === 'running'));
  const replaced = useMemo(() => replacedRunIds(runs), [runs]);
  return (
    <div>
      <div className="eyebrow mb-1.5">Agent runs · click one to open it</div>
      <ol className="space-y-0.5">
        {runs.map((r) => {
          const k = runKind[r.kind];
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => dock.watch(r.id)}
                title={replaced.has(r.id) ? `A later ${k.agent.toLowerCase()} run replaced this one` : undefined}
                className={cn('flex w-full items-center gap-3 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-hover', replaced.has(r.id) && 'opacity-55 hover:opacity-85')}
              >
                <AgentGlyph kind={r.kind} size="sm" />
                <span className="w-28 truncate text-sm text-ink">
                  {k.agent}
                  {r.round > 0 && r.kind !== 'gate' && <span className="text-ink-tertiary"> · R{r.round}</span>}
                </span>
                <RunBadge status={r.status} replaced={replaced.has(r.id)} />
                <VerdictBadge verdict={r.verdict} />
                <span className="numeric ml-auto flex items-center gap-3 text-xs text-ink-tertiary">
                  {r.model && <span className="hidden font-mono @md:inline">{r.model}</span>}
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
      toast.success(kind === 'question' ? 'Asked. The answer appears in the conversation.' : t.branch ? 'Feedback sent. A fresh fixer is starting.' : 'Feedback saved. A fresh executor is starting.');
    },
    onError: toastError,
  });
  if (t.status === 'proposed') return null;
  const ready = !!text.trim() && !send.isPending;
  return (
    <div className="rounded-lg border border-line bg-panel p-2 transition-[border-color,box-shadow] focus-within:border-line-focus focus-within:shadow-[0_0_0_3px_var(--fill-accent-subtle)]">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ready && send.mutate('feedback')}
        placeholder={t.branch ? 'Tell the fixer what to change on this branch, or ask a question about it…' : 'Add guidance for the executor, or ask a question…'}
        aria-label={`Message about ticket ${pad2(t.seq)}`}
        className="min-h-[3.5rem] w-full resize-y bg-transparent px-1.5 py-1 text-sm text-ink placeholder:text-ink-tertiary focus:outline-none"
      />
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto px-1.5 text-xs text-ink-tertiary">{MOD}↵ sends it to the {t.branch ? 'fixer' : 'executor'}</span>
        <Button size="sm" variant="ghost" icon={<MessageCircleQuestion />} disabled={!ready} onClick={() => send.mutate('question')}>
          Ask
        </Button>
        <Button size="sm" variant="primary" icon={<Send />} disabled={!ready} onClick={() => send.mutate('feedback')}>
          {t.branch ? 'Send to a fixer' : 'Send to an executor'}
        </Button>
      </div>
    </div>
  );
}

function EditTicketDialog({ ticket: t, open, onOpenChange }: { ticket: Ticket; open: boolean; onOpenChange: (v: boolean) => void }) {
  const initial = () => ({ title: t.title, what: t.what, goal: t.goal, outcome: t.outcome, guidance: t.guidance.join('\n'), acceptance: t.acceptance.join('\n') });
  const [form, setForm] = useState(initial);
  useEffect(() => {
    if (open) setForm(initial());
  }, [open, t]);
  const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  const save = useMutation({
    mutationFn: () => api.updateTicket(t.id, { title: form.title, what: form.what, goal: form.goal, outcome: form.outcome, guidance: lines(form.guidance), acceptance: lines(form.acceptance) }),
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
      size="lg"
      title={`Edit ticket ${pad2(t.seq)}`}
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
      <div className="space-y-3" onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && save.mutate()}>
        <Field label="Title">
          <Input value={form.title} onChange={set('title')} />
        </Field>
        <Field label="What happens">
          <Textarea value={form.what} onChange={set('what')} className="min-h-[4rem]" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Goal">
            <Textarea value={form.goal} onChange={set('goal')} className="min-h-[4rem]" />
          </Field>
          <Field label="Measurable outcome">
            <Textarea value={form.outcome} onChange={set('outcome')} className="min-h-[4rem]" />
          </Field>
        </div>
        <Field label="Guidance" hint="One per line.">
          <Textarea value={form.guidance} onChange={set('guidance')} className="min-h-[6rem] font-mono text-sm" />
        </Field>
        <Field label="Acceptance checks" hint="One per line.">
          <Textarea value={form.acceptance} onChange={set('acceptance')} className="min-h-[6rem] font-mono text-sm" />
        </Field>
      </div>
    </Dialog>
  );
}
