import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowRight, BellRing, Bot, Check, CircleDollarSign, FolderGit2, GitBranch, LayoutGrid, Layers, List, Plus, Rocket, Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { InitiativeSummary, Run } from '@factory/shared';
import { AgentGlyph } from '@/components/AgentGlyph';
import { InboxItemIcon } from '@/components/InboxItemIcon';
import { useRunDock } from '@/components/dock/use-run-dock';
import { useAppActions } from '@/components/shell/app-actions';
import { usePageMeta } from '@/components/shell/page-meta';
import { InitiativeBadge } from '@/components/StatusBadge';
import { Badge, Button, ButtonLink, Card, CardHeader, EmptyState, IconButton, Input, LiveDot, Page, PageHeader, Section, Segmented, SegmentedBar, Skeleton, Stat } from '@/components/ui';
import { api } from '@/lib/api';
import { initiativeSignal, progressSegments, shippedCount } from '@/lib/initiative';
import { layout, useLayout } from '@/lib/layout';
import { poolNote, poolSize, useCapacity, useNow } from '@/lib/live';
import { useActiveRuns, useInbox, useInitiatives, useProjects } from '@/lib/queries';
import { isNotArchived, runKind } from '@/lib/status';
import { addDays, weekStartUtc } from '@/lib/usage';
import { ago, cn, money, pad2, runDuration } from '@/lib/utils';
import { TONE } from '@/design/tone';

type Filter = 'active' | 'done' | 'archived' | 'all';
const FILTERS: Filter[] = ['active', 'done', 'archived', 'all'];
const isActive = (i: InitiativeSummary) => !['done', 'archived'].includes(i.status);

export function OverviewPage() {
  usePageMeta('Overview');
  const { newInitiative, addProject } = useAppActions();
  const { data: initiatives, isLoading } = useInitiatives();
  const { data: active = [] } = useActiveRuns();
  const { data: projects, isLoading: projectsLoading } = useProjects();
  const capacity = useCapacity();
  const [params, setParams] = useSearchParams();
  const filter = (FILTERS as string[]).includes(params.get('filter') ?? '') ? (params.get('filter') as Filter) : 'active';
  const [query, setQuery] = useState('');
  const { initiativeView } = useLayout();

  const list = initiatives ?? [];
  const live = list.filter(isNotArchived);
  const { items: waiting, total: waitingTotal } = useInbox();
  const running = active.filter((r) => r.status === 'running');
  const tickets = live.reduce((a, i) => a + i.ticketTotal, 0);
  const shipped = live.reduce((a, i) => a + shippedCount(i.ticketCounts), 0);
  const weekStart = weekStartUtc();
  const { data: week } = useQuery({ queryKey: ['usage', 'summary', weekStart.toISOString()], queryFn: () => api.usage(weekStart, addDays(weekStart, 7)) });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list
      .filter((i) => (filter === 'all' ? true : filter === 'active' ? isActive(i) : i.status === filter))
      .filter((i) => !q || `${i.title} ${i.projectName} ${i.baseBranch}`.toLowerCase().includes(q));
  }, [list, filter, query]);
  const counts: Record<Filter, number> = { active: list.filter(isActive).length, done: list.filter((i) => i.status === 'done').length, archived: list.filter((i) => i.status === 'archived').length, all: list.length };
  const queued = active.length - running.length;
  const poolSub = capacity ? [poolSize(capacity), queued ? `${queued} queued` : null, poolNote(capacity)].filter(Boolean).join(' · ') : queued ? `${queued} queued` : 'No agent running';
  const setFilter = (f: Filter) => setParams(f === 'active' ? {} : { filter: f }, { replace: true });
  const firstRun = !projectsLoading && !isLoading && (!projects?.length || !list.length);

  return (
    <Page width="wide">
      <PageHeader
        title="Overview"
        description="Everything the factory is building, where every agent is, and what waits on you."
        actions={
          <Button variant="primary" icon={<Plus />} onClick={newInitiative}>
            New initiative
          </Button>
        }
      />

      {firstRun && <GetStarted hasProject={!!projects?.length} hasInitiative={list.length > 0} onAddProject={addProject} onCreate={newInitiative} />}

      <div className="grid grid-cols-2 gap-3 @md:grid-cols-3 @xl:grid-cols-5">
        <Stat icon={<BellRing />} label="Waiting on you" value={waitingTotal} tone={waitingTotal ? 'warn' : undefined} sub={waitingTotal ? 'Open the inbox' : 'Nothing needs you'} to="/inbox" />
        <Stat icon={<Activity />} label="Agents running" value={running.length} sub={poolSub} live={running.length > 0} to="/agents" />
        <Stat icon={<Layers />} label="Active initiatives" value={counts.active} sub={`${counts.done} done`} />
        <Stat icon={<Rocket />} label="Tickets shipped" value={`${shipped}/${tickets}`} sub="Approved or merged" />
        <Stat icon={<CircleDollarSign />} label="Agent spend this week" value={week ? money(week.costUsd) : '—'} sub="Since Monday 00:00 UTC" to="/usage" />
      </div>

      {waiting.length > 0 && (
        <Section
          className="mt-8"
          title="Needs you"
          description="These stopped and wait for a decision only you can make."
          actions={
            <ButtonLink to="/inbox" variant="ghost" size="sm" end={<ArrowRight />}>
              Open the inbox
            </ButtonLink>
          }
        >
          <div className="grid grid-cols-1 gap-2 @lg:grid-cols-2">
            {waiting.slice(0, 4).map((item) => (
              <Link
                key={item.initiative.id}
                to={item.to}
                className="group flex items-center gap-3 rounded-xl border border-line bg-panel px-3 py-3 shadow-xs transition-colors hover:bg-hover"
              >
                <InboxItemIcon item={item} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{item.title}</span>
                  <span className={cn('block truncate text-xs', TONE[item.tone].ink)}>{item.initiative.attention}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-ink">
                  {item.cta} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        </Section>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 @xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Section
          title="Initiatives"
          actions={
            <>
              <Input size="sm" leading={<Search />} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by title, project or branch" className="w-56" aria-label="Filter initiatives" />
              <Segmented
                label="Show initiatives"
                value={filter}
                onChange={setFilter}
                options={FILTERS.map((f) => ({ value: f, label: `${f[0].toUpperCase()}${f.slice(1)} ${counts[f]}` }))}
              />
              <div className="flex rounded-lg border border-line-subtle p-0.5">
                <IconButton size="xs" label="Show as cards" icon={<LayoutGrid />} aria-pressed={initiativeView === 'cards'} variant={initiativeView === 'cards' ? 'secondary' : 'ghost'} onClick={() => layout.set({ initiativeView: 'cards' })} />
                <IconButton size="xs" label="Show as a list" icon={<List />} aria-pressed={initiativeView === 'list'} variant={initiativeView === 'list' ? 'secondary' : 'ghost'} onClick={() => layout.set({ initiativeView: 'list' })} />
              </div>
            </>
          }
        >
          {isLoading ? (
            <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
              {[0, 1, 2, 3].map((n) => (
                <Skeleton key={n} className="h-44 rounded-xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Layers />}
                title={query ? 'No initiative matches' : filter === 'active' ? 'Nothing in flight' : 'Nothing here'}
                actions={
                  !query && (
                    <Button variant="primary" icon={<Plus />} onClick={newInitiative}>
                      New initiative
                    </Button>
                  )
                }
              >
                {query ? `Nothing in “${filter}” has “${query}” in its title, project or branch.` : 'Describe a feature, and a fresh planner turns it into a reviewed plan and small tickets.'}
              </EmptyState>
            </Card>
          ) : initiativeView === 'cards' ? (
            <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
              {filtered.map((i) => (
                <InitiativeCard key={i.id} i={i} />
              ))}
            </div>
          ) : (
            <InitiativeTable initiatives={filtered} />
          )}
        </Section>

        <Section title="Running now" description={running.length ? `${running.length} agent${running.length > 1 ? 's' : ''} at work` : undefined}>
          <RunningNow runs={active} />
        </Section>
      </div>
    </Page>
  );
}

function GetStarted({ hasProject, hasInitiative, onAddProject, onCreate }: { hasProject: boolean; hasInitiative: boolean; onAddProject: () => void; onCreate: () => void }) {
  const steps: { title: string; body: string; done: boolean; action?: ReactNode }[] = [
    {
      title: 'Add a project',
      body: 'Point the factory at a git repository on this machine. It reads CLAUDE.md and suggests the checks every branch must pass.',
      done: hasProject,
      action: (
        <Button variant={hasProject ? 'ghost' : 'primary'} size="sm" icon={<FolderGit2 />} onClick={onAddProject}>
          Add a project
        </Button>
      ),
    },
    {
      title: 'Describe what you want built',
      body: 'Create an initiative with a title and a brief. A fresh planner reads the code and writes a plan with small tickets.',
      done: hasInitiative,
      action: hasProject && (
        <Button variant="primary" size="sm" icon={<Plus />} onClick={onCreate}>
          New initiative
        </Button>
      ),
    },
    { title: 'Approve the plan, then watch it ship', body: 'Nothing touches code until you approve. Then agents build, check, review and fix each ticket, and open pull requests.', done: false },
  ];
  return (
    <Card className="mb-6">
      <CardHeader icon={<Rocket />} title="Get started" description="Three steps from an idea to pull requests." />
      <ol className="grid grid-cols-1 divide-y divide-line-subtle @lg:grid-cols-3 @lg:divide-x @lg:divide-y-0">
        {steps.map((s, n) => (
          <li key={s.title} className="flex gap-3 p-4">
            <span className={cn('grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium', s.done ? 'bg-tone-good-fill text-ink-good' : 'bg-neutral-subtle text-ink-secondary')}>
              {s.done ? <Check className="size-3.5" /> : n + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className={cn('text-sm font-medium', s.done ? 'text-ink-secondary line-through' : 'text-ink')}>{s.title}</div>
              <p className="mt-0.5 text-pretty text-xs leading-relaxed text-ink-secondary">{s.body}</p>
              {!s.done && s.action && <div className="mt-3">{s.action}</div>}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function ProgressLine({ i }: { i: InitiativeSummary }) {
  const shipped = shippedCount(i.ticketCounts);
  return (
    <span className="text-xs text-ink-secondary">
      {i.ticketTotal ? (
        <>
          <span className="numeric text-ink">
            {shipped}/{i.ticketTotal}
          </span>{' '}
          tickets shipped
        </>
      ) : i.status === 'planning' ? (
        'Planning…'
      ) : (
        'No tickets yet'
      )}
    </span>
  );
}

function InitiativeCard({ i }: { i: InitiativeSummary }) {
  const signal = initiativeSignal(i);
  return (
    <Link to={`/i/${i.id}`} className="group flex flex-col rounded-xl border border-line-subtle bg-panel p-4 shadow-xs transition-[border-color,box-shadow] duration-hover hover:border-line hover:shadow-sm">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-md font-medium text-ink">{i.title}</div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-ink-tertiary">
            <FolderGit2 className="size-3.5 shrink-0" />
            <span className="truncate">{i.projectName}</span>
            <GitBranch className="ml-1 size-3.5 shrink-0" />
            <span className="truncate font-mono">{i.baseBranch}</span>
          </div>
        </div>
        <InitiativeBadge status={i.status} />
      </div>
      <p className="mt-3 line-clamp-2 min-h-[2.6em] text-pretty text-sm leading-relaxed text-ink-secondary">{i.planJson?.goal ?? i.brief}</p>
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <ProgressLine i={i} />
          {i.activeRuns > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-ink-alert">
              <LiveDot /> {i.activeRuns} agent{i.activeRuns > 1 ? 's' : ''} working
            </span>
          )}
        </div>
        <SegmentedBar segments={progressSegments(i.ticketCounts)} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line-subtle pt-3 text-xs">
        <span className={cn('truncate', i.attention ? TONE[signal.tone].ink : 'text-ink-tertiary')}>{i.attention ?? `Updated ${ago(i.updatedAt)}`}</span>
        <span className="numeric shrink-0 text-ink-tertiary">{money(i.costUsd)}</span>
      </div>
    </Link>
  );
}

function InitiativeTable({ initiatives }: { initiatives: InitiativeSummary[] }) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-line-subtle text-xs text-ink-tertiary">
          <tr>
            <th className="px-4 py-2.5 font-medium">Initiative</th>
            <th className="px-2 py-2.5 font-medium">Status</th>
            <th className="px-2 py-2.5 font-medium">Progress</th>
            <th className="px-2 py-2.5 text-right font-medium">Spent</th>
            <th className="px-4 py-2.5 text-right font-medium">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">
          {initiatives.map((i) => (
            <tr key={i.id} className="group relative transition-colors hover:bg-hover">
              <td className="max-w-0 px-4 py-2.5">
                <Link to={`/i/${i.id}`} className="block truncate font-medium text-ink after:absolute after:inset-0">
                  {i.title}
                </Link>
                <div className="truncate text-xs text-ink-tertiary">
                  {i.projectName} · <span className="font-mono">{i.baseBranch}</span>
                </div>
              </td>
              <td className="px-2 py-2.5">
                <div className="flex items-center gap-2">
                  <InitiativeBadge status={i.status} />
                  {i.activeRuns > 0 && (
                    <Badge tone="active" dot live>
                      {i.activeRuns}
                    </Badge>
                  )}
                </div>
                {i.attention && <div className="mt-1 truncate text-xs text-ink-warn">{i.attention}</div>}
              </td>
              <td className="w-48 px-2 py-2.5">
                <ProgressLine i={i} />
                <SegmentedBar className="mt-1.5" segments={progressSegments(i.ticketCounts)} />
              </td>
              <td className="numeric px-2 py-2.5 text-right text-ink-secondary">{money(i.costUsd)}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs text-ink-tertiary">{ago(i.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function RunningNow({ runs }: { runs: Run[] }) {
  return (
    <Card>
      {runs.length === 0 ? (
        <EmptyState icon={<Bot />} title="No agent is running" className="py-10">
          Agents show up here the moment one starts.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line-subtle">
          {runs.slice(0, 8).map((r) => (
            <li key={r.id}>
              <RunLine run={r} />
            </li>
          ))}
        </ul>
      )}
      <Link to="/agents" className="flex items-center justify-center gap-1 border-t border-line-subtle px-4 py-2.5 text-xs font-medium text-ink-secondary transition-colors hover:text-ink">
        All agent runs <ArrowRight className="size-3.5" />
      </Link>
    </Card>
  );
}

function RunLine({ run }: { run: Run }) {
  const dock = useRunDock();
  const now = useNow(1000, run.status === 'running');
  const k = runKind[run.kind];
  return (
    <button type="button" onClick={() => dock.watch(run.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hover">
      <AgentGlyph kind={run.kind} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-ink">
          {k.agent}
          {run.ticketSeq ? <span className="text-ink-tertiary"> · {pad2(run.ticketSeq)}</span> : null}
        </div>
        <div className="truncate text-xs text-ink-tertiary">{run.ticketTitle ?? run.initiativeTitle}</div>
      </div>
      <div className="shrink-0 text-right">
        {run.status === 'running' ? <div className="numeric text-xs text-ink-alert">{runDuration(run, now)}</div> : <div className="text-xs text-ink-tertiary">queued</div>}
        <div className="font-mono text-2xs text-ink-tertiary">{run.model ?? 'checks'}</div>
      </div>
    </button>
  );
}
