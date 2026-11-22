import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowRight, BellRing, CircleDollarSign, FolderGit2, Layers, Plus, Rocket, Sparkles } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import type { InitiativeSummary, Run } from '@factory/shared';
import { api } from '@/lib/api';
import { poolNote, poolSize, useCapacity, useNow } from '@/lib/live';
import { runKind, isNotArchived } from '@/lib/status';
import { ago, cn, money, pad2, runDuration } from '@/lib/utils';
import { InitiativePill } from '@/components/StatusPill';
import { useRunDrawer } from '@/components/RunDrawer';
import { Button, EmptyState, Segmented, SegmentedBar, Skeleton, LiveDot } from '@/components/ui';

type Filter = 'active' | 'done' | 'archived' | 'all';

export function Dashboard() {
  const { openNew } = useOutletContext<{ openNew: () => void }>();
  const { data: initiatives, isLoading } = useQuery({ queryKey: ['initiatives'], queryFn: api.initiatives });
  const { data: active = [] } = useQuery({ queryKey: ['runs', 'active'], queryFn: () => api.runs({ active: true }) });
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const [filter, setFilter] = useState<Filter>('active');

  const list = initiatives ?? [];
  const stats = useMemo(() => {
    const live = list.filter(isNotArchived);
    const tickets = live.reduce((a, i) => a + i.ticketTotal, 0);
    const shipped = live.reduce((a, i) => a + (i.ticketCounts.approved ?? 0) + (i.ticketCounts.merged ?? 0), 0);
    return {
      activeInitiatives: live.filter((i) => !['done', 'archived'].includes(i.status)).length,
      attention: live.filter((i) => i.attention).length,
      tickets,
      shipped,
      cost: list.reduce((a, i) => a + i.costUsd, 0),
    };
  }, [list]);

  const filtered = list.filter((i) =>
    filter === 'all' ? true : filter === 'active' ? !['done', 'archived'].includes(i.status) : i.status === filter,
  );
  const attention = list.filter((i) => i.attention && isNotArchived(i));
  const running = active.filter((r) => r.status === 'running');
  const capacity = useCapacity();
  const queuedNote = active.length > running.length ? `${active.length - running.length} queued` : undefined;
  const poolSub = capacity ? [poolSize(capacity), queuedNote, poolNote(capacity)].filter(Boolean).join(' · ') : queuedNote;

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-8 lg:px-8">
      <header className="mb-7 flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-violet-400/20 bg-violet-400/[0.07] px-2.5 py-0.5 text-2xs font-medium text-violet-200">
            <Sparkles className="h-3 w-3" /> Plan → approve → build → review → fix, each step in a fresh agent
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <span className="text-gradient">Factory floor</span>
          </h1>
          <p className="mt-1 text-sm text-zinc-500">Everything you are building, where every agent is, and what is waiting on you.</p>
        </div>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openNew}>
          New initiative
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat icon={<Layers />} label="Active initiatives" value={stats.activeInitiatives} />
        <Stat icon={<Activity />} label="Agents running" value={running.length} sub={poolSub} live={running.length > 0} />
        <Stat icon={<BellRing />} label="Waiting on you" value={stats.attention} tone={stats.attention ? 'attention' : undefined} />
        <Stat icon={<Rocket />} label="Tickets approved" value={`${stats.shipped}/${stats.tickets}`} />
        <Stat icon={<CircleDollarSign />} label="Agent spend" value={money(stats.cost)} sub="API-equivalent" />
      </div>

      {attention.length > 0 && (
        <section className="mt-7">
          <h2 className="section-title mb-2.5 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Needs you
          </h2>
          <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {attention.map((i) => (
              <Link
                key={i.id}
                to={`/i/${i.id}`}
                className="group flex items-center gap-3 rounded-xl border border-amber-400/20 bg-gradient-to-r from-amber-400/[0.07] to-transparent px-4 py-3 transition-colors hover:border-amber-400/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-zinc-100">{i.title}</div>
                  <div className="text-xs text-amber-200/80">{i.attention}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-amber-300/60 transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Initiatives</h2>
            <Segmented
              size="xs"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'done', label: 'Done' },
                { value: 'archived', label: 'Archived' },
                { value: 'all', label: 'All' },
              ]}
            />
          </div>
          {isLoading ? (
            <div className="grid gap-3 md:grid-cols-2">
              {[0, 1, 2, 3].map((n) => (
                <Skeleton key={n} className="h-36 rounded-xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="card">
              {projects.length === 0 ? (
                <EmptyState
                  icon={<FolderGit2 />}
                  title="Start by adding a repository"
                  action={
                    <Link to="/projects">
                      <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />}>
                        Add a project
                      </Button>
                    </Link>
                  }
                >
                  Projects are local git repos. Every ticket is built in its own worktree on a <span className="font-mono">factory/*</span> branch, so
                  your checkout is never touched.
                </EmptyState>
              ) : (
                <EmptyState icon={<Layers />} title={filter === 'active' ? 'Nothing in flight' : 'Nothing here'} action={<Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={openNew}>New initiative</Button>}>
                  Describe a feature; a fresh planner turns it into a reviewed plan and small tickets.
                </EmptyState>
              )}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filtered.map((i) => (
                <InitiativeCard key={i.id} i={i} />
              ))}
            </div>
          )}
        </section>

        <aside>
          <h2 className="section-title mb-3">Running now</h2>
          <div className="card divide-y divide-line">
            {active.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-zinc-600">No agents running. They appear here the moment one starts.</p>
            ) : (
              active.slice(0, 8).map((r) => <RunLine key={r.id} run={r} />)
            )}
            {active.length > 0 && (
              <Link to="/agents" className="flex items-center justify-center gap-1 px-4 py-2 text-2xs text-zinc-500 hover:text-zinc-300">
                All agents <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, sub, live, tone }: { icon: ReactNode; label: string; value: ReactNode; sub?: string; live?: boolean; tone?: 'attention' }) {
  return (
    <div className={cn('card relative overflow-hidden px-4 py-3.5', tone === 'attention' && 'border-amber-400/30')}>
      <div className="flex items-center gap-2 text-2xs text-zinc-500 [&>svg]:h-3.5 [&>svg]:w-3.5">
        {icon}
        {label}
        {live && <LiveDot className="ml-auto" />}
      </div>
      <div className={cn('mt-1.5 font-mono text-2xl font-medium tabular-nums tracking-tight', tone === 'attention' ? 'text-amber-200' : 'text-zinc-100')}>{value}</div>
      {sub && <div className="text-2xs text-zinc-600">{sub}</div>}
    </div>
  );
}

function InitiativeCard({ i }: { i: InitiativeSummary }) {
  const c = i.ticketCounts;
  const done = (c.approved ?? 0) + (c.merged ?? 0);
  return (
    <Link to={`/i/${i.id}`} className="card group flex flex-col gap-3 p-4 transition-all hover:-translate-y-px hover:border-line-strong">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-zinc-100 group-hover:text-white">{i.title}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-2xs text-zinc-500">
            <FolderGit2 className="h-3 w-3" /> {i.projectName}
            <span className="text-zinc-700">·</span>
            <span className="font-mono">{i.baseBranch}</span>
          </div>
        </div>
        <InitiativePill status={i.status} />
      </div>
      <p className="line-clamp-2 min-h-[2.5em] text-xs leading-relaxed text-zinc-500">{i.planJson?.goal ?? i.brief}</p>
      <div>
        <div className="mb-1.5 flex items-center justify-between text-2xs text-zinc-500">
          <span>{i.ticketTotal ? `${done}/${i.ticketTotal} tickets approved` : i.status === 'planning' ? 'Planning…' : 'No tickets yet'}</span>
          {i.activeRuns > 0 && (
            <span className="flex items-center gap-1 text-cyan-300">
              <LiveDot /> {i.activeRuns} agent{i.activeRuns > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <SegmentedBar
          segments={[
            { value: done, tone: 'success' },
            { value: c.built ?? 0, tone: 'info' },
            { value: (c.building ?? 0) + (c.checking ?? 0) + (c.in_review ?? 0) + (c.fixing ?? 0), tone: 'active' },
            { value: c.changes_requested ?? 0, tone: 'attention' },
            { value: c.blocked ?? 0, tone: 'danger' },
            { value: (c.todo ?? 0) + (c.proposed ?? 0), tone: 'muted' },
          ]}
        />
      </div>
      <div className="flex items-center justify-between text-2xs text-zinc-600">
        <span>{i.attention ? <span className="text-amber-300/90">{i.attention}</span> : `updated ${ago(i.updatedAt)}`}</span>
        <span className="font-mono">{money(i.costUsd)}</span>
      </div>
    </Link>
  );
}

function RunLine({ run }: { run: Run }) {
  const drawer = useRunDrawer();
  const now = useNow(1000);
  const k = runKind[run.kind];
  return (
    <button onClick={() => drawer.open(run.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.02]">
      <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line bg-surface-2', k.color)}>
        <k.icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-zinc-200">
          {k.agent}
          {run.ticketSeq ? <span className="text-zinc-500"> · {pad2(run.ticketSeq)} {run.ticketTitle}</span> : null}
        </div>
        <div className="truncate text-2xs text-zinc-500">{run.initiativeTitle}</div>
      </div>
      <div className="text-right">
        {run.status === 'running' ? (
          <div className="font-mono text-2xs tabular-nums text-cyan-300">{runDuration(run, now)}</div>
        ) : (
          <div className="text-2xs text-zinc-500">queued</div>
        )}
        <div className="font-mono text-[10px] text-zinc-600">{run.model ?? 'checks'}</div>
      </div>
    </button>
  );
}
