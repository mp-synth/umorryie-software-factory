import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CircleDollarSign, Info } from 'lucide-react';
import type { UsageBucket, UsageSession, UsageWeek } from '@factory/shared';
import { Card, CardHeader, EmptyState, IconButton, Skeleton, Tooltip } from '@/components/ui';
import { api } from '@/lib/api';
import { addDays, dayName, kindLabel, modelLabel, weekLabel, weekStartUtc } from '@/lib/usage';
import { cn, money, tokens } from '@/lib/utils';

const WEEK_PARAM = /^\d{4}-\d{2}-\d{2}$/;

export function UsagePage() {
  const [params, setParams] = useSearchParams();
  const thisWeek = weekStartUtc();
  const weekParam = params.get('week');
  const weekStart = weekParam && WEEK_PARAM.test(weekParam) ? weekStartUtc(new Date(`${weekParam}T12:00:00Z`)) : thisWeek;
  const weekEnd = addDays(weekStart, 7);
  const isThisWeek = weekStart.getTime() === thisWeek.getTime();
  const day = params.get('day');
  const key = weekStart.toISOString();

  const summary = useQuery({ queryKey: ['usage', 'summary', key], queryFn: () => api.usage(weekStart, weekEnd) });
  const sessions = useQuery({ queryKey: ['usage', 'sessions', key], queryFn: () => api.usageSessions(weekStart, weekEnd) });
  const weeks = useQuery({ queryKey: ['usage', 'weeks'], queryFn: api.usageWeeks });

  const go = (week: Date | null, nextDay: string | null = null) => {
    const next = new URLSearchParams();
    if (week && week.getTime() !== thisWeek.getTime()) next.set('week', week.toISOString().slice(0, 10));
    if (nextDay) next.set('day', nextDay);
    setParams(next);
  };
  const pickDay = (d: string | null) => go(weekStart, d === day ? null : d);

  const previous = weeks.data?.find((w) => w.weekStart === addDays(weekStart, -7).toISOString());
  const shown = useMemo(() => (sessions.data ?? []).filter((s) => !day || s.startedAt.slice(0, 10) === day), [sessions.data, day]);
  const sessionsInRange = day ? summary.data?.byDay.find((d) => d.key === day)?.sessions : summary.data?.sessions;

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-8 @lg:px-8">
      <header className="mb-6 flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-50">Usage</h1>
          <p className="mt-1 text-sm text-zinc-500">
            What the factory's agents spent, priced from every API response in each session's transcript at Claude API list prices. Weeks start Monday 00:00 UTC.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <IconButton label="Previous week" icon={<ChevronLeft className="h-4 w-4" />} onClick={() => go(addDays(weekStart, -7))} />
          <div className="min-w-[150px] text-center text-sm text-zinc-300">{isThisWeek ? 'This week' : weekLabel(weekStart)}</div>
          <IconButton label="Next week" icon={<ChevronRight className="h-4 w-4" />} disabled={isThisWeek} onClick={() => go(addDays(weekStart, 7))} />
        </div>
      </header>

      <div className="grid gap-3 @lg:grid-cols-[minmax(260px,1fr)_3fr]">
        <Card className="px-5 py-4">
          <div className="flex items-center gap-2 text-2xs text-zinc-500">
            <CircleDollarSign className="h-3.5 w-3.5" />
            {isThisWeek ? 'Spent since Monday 00:00 UTC' : weekLabel(weekStart)}
          </div>
          {summary.data ? (
            <>
              <div className="mt-2 text-5xl font-semibold tracking-tight text-zinc-50">{money(summary.data.costUsd)}</div>
              <div className="mt-1.5 text-xs text-zinc-500">
                {summary.data.sessions} agent session{summary.data.sessions === 1 ? '' : 's'}
                {previous ? ` · previous week ${money(previous.costUsd)}` : ''}
              </div>
              <TokenSplit t={summary.data.tokens} />
            </>
          ) : (
            <Skeleton className="mt-2 h-24 w-40" />
          )}
        </Card>
        <Card className="px-5 py-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="section-title">By day</span>
            <span className="text-2xs text-zinc-600">{day ? `showing ${dayName(day, 'long')} · click it again for the whole week` : 'click a day to see its sessions'}</span>
          </div>
          {summary.data ? <DayColumns days={summary.data.byDay} selected={day} onPick={pickDay} /> : <Skeleton className="h-[164px] w-full" />}
        </Card>
      </div>

      <div className="mt-3 grid gap-3 @lg:grid-cols-2">
        <Card>
          <CardHeader title="By step" sub="Which kind of agent the money went to" />
          <div className="px-4 py-3.5">{summary.data ? <RankedBars buckets={summary.data.byKind} label={kindLabel} /> : <Skeleton className="h-32" />}</div>
        </Card>
        <Card>
          <CardHeader title="By model" />
          <div className="px-4 py-3.5">{summary.data ? <RankedBars buckets={summary.data.byModel} label={modelLabel} /> : <Skeleton className="h-32" />}</div>
        </Card>
      </div>

      <section className="mt-7">
        <h2 className="section-title mb-2.5">
          Sessions {day ? `on ${dayName(day, 'long')}` : isThisWeek ? 'this week' : `in ${weekLabel(weekStart)}`}
          {shown.length > 0 && (
            <span className="ml-2 normal-case tracking-normal text-zinc-600">
              {sessionsInRange && shown.length < sessionsInRange ? `showing the latest ${shown.length} of ${sessionsInRange}` : shown.length}
            </span>
          )}
        </h2>
        <SessionTable sessions={shown} loading={sessions.isPending} />
      </section>

      <section className="mt-7">
        <h2 className="section-title mb-2.5">History</h2>
        <WeekList weeks={weeks.data ?? []} current={weekStart} onPick={(w) => go(w)} />
      </section>

      <p className="mt-6 flex items-start gap-1.5 text-2xs text-zinc-600">
        <Info className="mt-px h-3 w-3 shrink-0" />
        Only sessions the factory started: its agents, failed and cancelled ones included, and those of initiatives since reset or deleted. Your own Claude Code
        sessions on this machine are not here, though an organization's usage dashboard counts them too.
      </p>
    </div>
  );
}

function TokenSplit({ t }: { t: { input: number; cacheWrite: number; cacheRead: number; output: number } }) {
  const rows: [string, number][] = [
    ['Cache writes', t.cacheWrite],
    ['Cache reads', t.cacheRead],
    ['Output', t.output],
    ['Uncached input', t.input],
  ];
  return (
    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-line pt-3 text-2xs">
      {rows.map(([name, n]) => (
        <div key={name} className="flex justify-between gap-2">
          <dt className="text-zinc-500">{name}</dt>
          <dd className="font-mono tabular-nums text-zinc-300">{tokens(n)}</dd>
        </div>
      ))}
    </dl>
  );
}

const PLOT_PX = 128;

function DayColumns({ days, selected, onPick }: { days: UsageBucket[]; selected: string | null; onPick: (day: string) => void }) {
  const max = Math.max(...days.map((d) => d.costUsd), 0);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div>
      <div className="relative flex gap-1.5 border-b border-line" style={{ height: PLOT_PX }}>
        {max > 0 && <span className="pointer-events-none absolute -top-0.5 left-0 font-mono text-2xs tabular-nums text-zinc-600">{money(max)}</span>}
        {days.map((d) => {
          const future = d.key > today;
          const h = max > 0 ? Math.max((d.costUsd / max) * (PLOT_PX - 18), d.costUsd > 0 ? 3 : 0) : 0;
          return (
            <Tooltip key={d.key} content={future ? `${dayName(d.key, 'long')}: not yet` : `${dayName(d.key, 'long')}: ${money(d.costUsd)} · ${d.sessions} session${d.sessions === 1 ? '' : 's'}`}>
              <button
                type="button"
                disabled={future}
                onClick={() => onPick(d.key)}
                aria-label={`${dayName(d.key, 'long')}: ${money(d.costUsd)}, ${d.sessions} sessions`}
                aria-pressed={selected === d.key}
                className="group flex h-full flex-1 flex-col justify-end rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/60 disabled:cursor-default"
              >
                {selected === d.key && d.costUsd > 0 && (
                  <span className="mb-1 text-center font-mono text-2xs tabular-nums text-zinc-300">{money(d.costUsd)}</span>
                )}
                <span
                  className={cn(
                    'mx-auto block w-full max-w-[56px] rounded-t transition-colors',
                    selected && selected !== d.key ? 'bg-cyan-400/30 group-hover:bg-cyan-400/50' : 'bg-cyan-400/75 group-hover:bg-cyan-300',
                  )}
                  style={{ height: h }}
                />
              </button>
            </Tooltip>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {days.map((d) => (
          <div key={d.key} className={cn('flex-1 truncate text-center text-2xs', d.key === selected ? 'text-zinc-200' : d.key > today ? 'text-zinc-700' : 'text-zinc-500')}>
            {dayName(d.key)}
          </div>
        ))}
      </div>
    </div>
  );
}

function RankedBars({ buckets, label }: { buckets: UsageBucket[]; label: (key: string) => string }) {
  if (buckets.length === 0) return <p className="py-6 text-center text-xs text-zinc-500">No agent sessions in this week.</p>;
  const max = buckets[0].costUsd || 1;
  const total = buckets.reduce((a, b) => a + b.costUsd, 0) || 1;
  return (
    <ul className="space-y-2.5">
      {buckets.map((b) => (
        <li key={b.key} className="text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-zinc-300">{label(b.key)}</span>
            <span className="shrink-0 font-mono text-2xs tabular-nums text-zinc-300">
              {money(b.costUsd)}
              <span className="text-zinc-600">
                {' '}
                · {Math.round((b.costUsd / total) * 100)}% · {b.sessions} session{b.sessions === 1 ? '' : 's'}
              </span>
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-cyan-400/75" style={{ width: `${(b.costUsd / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function utcTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short' })} ${d.toISOString().slice(11, 16)}`;
}

function SessionTable({ sessions, loading }: { sessions: UsageSession[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-40" />;
  if (sessions.length === 0) {
    return <EmptyState icon={<CircleDollarSign />} title="No agent sessions">Agents show up here once they have made their first API call.</EmptyState>;
  }
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-xs">
        <thead className="border-b border-line text-2xs text-zinc-500">
          <tr>
            <th className="whitespace-nowrap px-4 py-2 font-medium">Started (UTC)</th>
            <th className="px-2 py-2 font-medium">Step</th>
            <th className="px-2 py-2 font-medium">Working on</th>
            <th className="hidden px-2 py-2 font-medium @lg:table-cell">Model</th>
            <th className="hidden px-2 py-2 text-right font-medium @lg:table-cell">Requests</th>
            <th className="hidden px-2 py-2 text-right font-medium @xl:table-cell">Cache write / read</th>
            <th className="px-2 py-2 text-right font-medium">Output</th>
            <th className="px-4 py-2 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.sessionId} className="border-b border-line/60 last:border-0 hover:bg-surface-2/60">
              <td className="whitespace-nowrap px-4 py-2 font-mono text-2xs tabular-nums text-zinc-500">{utcTime(s.startedAt)}</td>
              <td className="whitespace-nowrap px-2 py-2 text-zinc-300">{kindLabel(s.kind)}</td>
              <td className="w-full max-w-0 px-2 py-2">
                {s.runId ? (
                  <Link to={`/agents?run=${s.runId}`} className="block truncate text-zinc-300 hover:text-cyan-300" title={s.label ?? undefined}>
                    {s.label ?? 'Run'}
                  </Link>
                ) : (
                  <span className="block truncate text-zinc-500" title="Its run was deleted with a reset or deleted initiative, or it ran outside an initiative">
                    {s.label ?? 'Unlinked session'}
                  </span>
                )}
                {s.runStatus && s.runStatus !== 'succeeded' && <span className="text-2xs text-zinc-600">{s.runStatus}</span>}
              </td>
              <td className="hidden whitespace-nowrap px-2 py-2 font-mono text-2xs text-zinc-500 @lg:table-cell">
                {modelLabel(s.model)}
                {s.effort ? ` · ${s.effort}` : ''}
              </td>
              <td className="hidden px-2 py-2 text-right font-mono text-2xs tabular-nums text-zinc-500 @lg:table-cell">{s.requests}</td>
              <td className="hidden whitespace-nowrap px-2 py-2 text-right font-mono text-2xs tabular-nums text-zinc-500 @xl:table-cell">
                {s.tokens.cacheWrite + s.tokens.cacheRead === 0 && s.pricedFrom === 'cli' ? '—' : `${tokens(s.tokens.cacheWrite)} / ${tokens(s.tokens.cacheRead)}`}
              </td>
              <td className="px-2 py-2 text-right font-mono text-2xs tabular-nums text-zinc-500">{tokens(s.tokens.output)}</td>
              <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-2xs tabular-nums text-zinc-300">
                {s.pricedFrom === 'cli' ? (
                  <Tooltip content="The figure the claude CLI reported: no transcript is left, or part of the session ran on a model without a list price here">
                    <span>≈{money(s.costUsd)}</span>
                  </Tooltip>
                ) : (
                  money(s.costUsd)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WeekList({ weeks, current, onPick }: { weeks: UsageWeek[]; current: Date; onPick: (week: Date) => void }) {
  if (weeks.length === 0) return <p className="text-xs text-zinc-500">No recorded spend yet.</p>;
  const max = Math.max(...weeks.map((w) => w.costUsd)) || 1;
  return (
    <div className="card divide-y divide-line/60">
      {weeks.map((w) => {
        const start = new Date(w.weekStart);
        const active = start.getTime() === current.getTime();
        return (
          <button
            key={w.weekStart}
            type="button"
            onClick={() => onPick(start)}
            className={cn('grid w-full grid-cols-[150px_1fr_auto] items-center gap-3 px-4 py-2 text-left text-xs hover:bg-surface-2/60', active && 'bg-surface-2')}
          >
            <span className={active ? 'text-zinc-100' : 'text-zinc-400'}>{weekLabel(start)}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <span className="block h-full rounded-full bg-cyan-400/75" style={{ width: `${(w.costUsd / max) * 100}%` }} />
            </span>
            <span className="w-[132px] text-right font-mono text-2xs tabular-nums text-zinc-400">
              {money(w.costUsd)} <span className="text-zinc-600">· {w.sessions}×</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
