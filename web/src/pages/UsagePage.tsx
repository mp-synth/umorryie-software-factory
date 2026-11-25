import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CircleDollarSign, Info } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { UsageBucket, UsageSession, UsageWeek } from '@factory/shared';
import { usePageMeta } from '@/components/shell/page-meta';
import { Button, Card, CardHeader, EmptyState, IconButton, Page, PageHeader, Section, Skeleton, Tooltip } from '@/components/ui';
import { api } from '@/lib/api';
import { addDays, dayName, kindLabel, modelLabel, weekLabel, weekStartUtc } from '@/lib/usage';
import { cn, money, tokens } from '@/lib/utils';

const WEEK_PARAM = /^\d{4}-\d{2}-\d{2}$/;

export function UsagePage() {
  usePageMeta('Usage');
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
    <Page width="wide">
      <PageHeader
        title="Usage"
        description="What the factory's agents spent, priced from every API response in each session's transcript at Claude API list prices. Weeks start Monday 00:00 UTC."
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-line-subtle p-0.5">
            <IconButton label="Previous week" icon={<ChevronLeft />} onClick={() => go(addDays(weekStart, -7))} />
            <div className="min-w-[9.5rem] text-center text-sm font-medium text-ink">{isThisWeek ? 'This week' : weekLabel(weekStart)}</div>
            <IconButton label="Next week" icon={<ChevronRight />} disabled={isThisWeek} onClick={() => go(addDays(weekStart, 7))} />
          </div>
        }
      />

      <div className="grid gap-3 @lg:grid-cols-[minmax(16rem,1fr)_3fr]">
        <Card className="px-5 py-4">
          <div className="flex items-center gap-2 text-xs font-medium text-ink-secondary">
            <CircleDollarSign className="size-3.5" />
            {isThisWeek ? 'Spent since Monday 00:00 UTC' : weekLabel(weekStart)}
          </div>
          {summary.data ? (
            <>
              <div className="numeric heading mt-2 text-3xl text-ink">{money(summary.data.costUsd)}</div>
              <div className="mt-1.5 text-sm text-ink-secondary">
                {summary.data.sessions} agent session{summary.data.sessions === 1 ? '' : 's'}
                {previous ? ` · the week before: ${money(previous.costUsd)}` : ''}
              </div>
              <TokenSplit t={summary.data.tokens} />
            </>
          ) : (
            <Skeleton className="mt-2 h-24 w-40" />
          )}
        </Card>
        <Card className="px-5 py-4">
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-sm font-medium text-ink">By day</h2>
            <span className="text-xs text-ink-tertiary">{day ? `Showing ${dayName(day, 'long')}. Click it again for the whole week.` : 'Click a day to see its sessions.'}</span>
            {day && (
              <Button size="xs" variant="ghost" className="ml-auto" onClick={() => pickDay(null)}>
                Show the whole week
              </Button>
            )}
          </div>
          {summary.data ? <DayColumns days={summary.data.byDay} selected={day} onPick={pickDay} /> : <Skeleton className="h-[10rem] w-full" />}
        </Card>
      </div>

      <div className="mt-3 grid gap-3 @lg:grid-cols-2">
        <Card>
          <CardHeader title="By step" description="Which kind of agent the money went to" />
          <div className="px-4 py-4">{summary.data ? <RankedBars buckets={summary.data.byKind} label={kindLabel} /> : <Skeleton className="h-32" />}</div>
        </Card>
        <Card>
          <CardHeader title="By model" />
          <div className="px-4 py-4">{summary.data ? <RankedBars buckets={summary.data.byModel} label={modelLabel} /> : <Skeleton className="h-32" />}</div>
        </Card>
      </div>

      <Section
        className="mt-8"
        title={`Sessions ${day ? `on ${dayName(day, 'long')}` : isThisWeek ? 'this week' : `in ${weekLabel(weekStart)}`}`}
        description={shown.length > 0 ? (sessionsInRange && shown.length < sessionsInRange ? `Showing the latest ${shown.length} of ${sessionsInRange}` : `${shown.length} session${shown.length === 1 ? '' : 's'}`) : undefined}
      >
        <SessionTable sessions={shown} loading={sessions.isPending} />
      </Section>

      <Section className="mt-8" title="History">
        <WeekList weeks={weeks.data ?? []} current={weekStart} onPick={(w) => go(w)} />
      </Section>

      <p className="mt-6 flex items-start gap-1.5 text-pretty text-xs text-ink-tertiary">
        <Info className="mt-px size-3.5 shrink-0" />
        Only sessions the factory started: its agents, failed and cancelled ones included, and those of initiatives since reset or deleted. Your own Claude Code sessions on this
        machine are not here, though an organization's usage dashboard counts them too.
      </p>
    </Page>
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
    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-line-subtle pt-3 text-xs">
      {rows.map(([name, n]) => (
        <div key={name} className="flex justify-between gap-2">
          <dt className="text-ink-tertiary">{name}</dt>
          <dd className="numeric text-ink">{tokens(n)}</dd>
        </div>
      ))}
    </dl>
  );
}

const PLOT_PX = 136;

function DayColumns({ days, selected, onPick }: { days: UsageBucket[]; selected: string | null; onPick: (day: string) => void }) {
  const max = Math.max(...days.map((d) => d.costUsd), 0);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div>
      <div className="relative flex gap-2 border-b border-line-subtle" style={{ height: PLOT_PX }}>
        {max > 0 && <span className="numeric pointer-events-none absolute -top-0.5 left-0 text-2xs text-ink-tertiary">{money(max)}</span>}
        {days.map((d) => {
          const future = d.key > today;
          const h = max > 0 ? Math.max((d.costUsd / max) * (PLOT_PX - 20), d.costUsd > 0 ? 3 : 0) : 0;
          return (
            <Tooltip key={d.key} content={future ? `${dayName(d.key, 'long')}: not yet` : `${dayName(d.key, 'long')}: ${money(d.costUsd)} · ${d.sessions} session${d.sessions === 1 ? '' : 's'}`}>
              <button
                type="button"
                disabled={future}
                onClick={() => onPick(d.key)}
                aria-label={`${dayName(d.key, 'long')}: ${money(d.costUsd)}, ${d.sessions} sessions`}
                aria-pressed={selected === d.key}
                className="group flex h-full flex-1 flex-col justify-end rounded-sm disabled:cursor-default"
              >
                {selected === d.key && d.costUsd > 0 && <span className="numeric mb-1 text-center text-2xs text-ink">{money(d.costUsd)}</span>}
                <span
                  className={cn(
                    'mx-auto block w-full max-w-[3.5rem] rounded-t-sm transition-opacity',
                    'bg-tone-accent-solid',
                    selected && selected !== d.key ? 'opacity-30 group-hover:opacity-60' : 'opacity-85 group-hover:opacity-100',
                  )}
                  style={{ height: h }}
                />
              </button>
            </Tooltip>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-2">
        {days.map((d) => (
          <div key={d.key} className={cn('flex-1 truncate text-center text-2xs', d.key === selected ? 'font-medium text-ink' : d.key > today ? 'text-ink-disabled' : 'text-ink-tertiary')}>
            {dayName(d.key)}
          </div>
        ))}
      </div>
    </div>
  );
}

function RankedBars({ buckets, label }: { buckets: UsageBucket[]; label: (key: string) => string }) {
  if (buckets.length === 0) return <p className="py-6 text-center text-sm text-ink-tertiary">No agent sessions in this week.</p>;
  const max = buckets[0].costUsd || 1;
  const total = buckets.reduce((a, b) => a + b.costUsd, 0) || 1;
  return (
    <ul className="space-y-3">
      {buckets.map((b) => (
        <li key={b.key} className="text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-ink">{label(b.key)}</span>
            <span className="numeric shrink-0 text-xs text-ink">
              {money(b.costUsd)}
              <span className="text-ink-tertiary">
                {' '}
                · {Math.round((b.costUsd / total) * 100)}% · {b.sessions} session{b.sessions === 1 ? '' : 's'}
              </span>
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-subtle">
            <div className="h-full rounded-full bg-tone-accent-solid" style={{ width: `${(b.costUsd / max) * 100}%` }} />
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
  if (loading) return <Skeleton className="h-40 rounded-xl" />;
  if (sessions.length === 0) {
    return (
      <Card>
        <EmptyState icon={<CircleDollarSign />} title="No agent sessions">
          Agents show up here once they have made their first API call.
        </EmptyState>
      </Card>
    );
  }
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[600px] text-left text-sm">
        <thead className="border-b border-line-subtle text-xs text-ink-tertiary">
          <tr>
            <th className="whitespace-nowrap px-4 py-2.5 font-medium">Started (UTC)</th>
            <th className="px-2 py-2.5 font-medium">Step</th>
            <th className="px-2 py-2.5 font-medium">Working on</th>
            <th className="hidden px-2 py-2.5 font-medium @lg:table-cell">Model</th>
            <th className="hidden px-2 py-2.5 text-right font-medium @lg:table-cell">Requests</th>
            <th className="hidden px-2 py-2.5 text-right font-medium @xl:table-cell">Cache write / read</th>
            <th className="px-2 py-2.5 text-right font-medium">Output</th>
            <th className="px-4 py-2.5 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">
          {sessions.map((s) => (
            <tr key={s.sessionId} className="transition-colors hover:bg-hover">
              <td className="numeric whitespace-nowrap px-4 py-2 text-xs text-ink-tertiary">{utcTime(s.startedAt)}</td>
              <td className="whitespace-nowrap px-2 py-2 text-ink">{kindLabel(s.kind)}</td>
              <td className="w-full max-w-0 px-2 py-2">
                {s.runId ? (
                  <Link to={`/agents?run=${s.runId}`} className="block truncate text-ink hover:underline" title={s.label ?? undefined}>
                    {s.label ?? 'Run'}
                  </Link>
                ) : (
                  <span className="block truncate text-ink-tertiary" title="Its run was deleted with a reset or deleted initiative, or it ran outside an initiative">
                    {s.label ?? 'Unlinked session'}
                  </span>
                )}
                {s.runStatus && s.runStatus !== 'succeeded' && <span className="text-xs text-ink-tertiary">{s.runStatus}</span>}
              </td>
              <td className="hidden whitespace-nowrap px-2 py-2 font-mono text-xs text-ink-secondary @lg:table-cell">
                {modelLabel(s.model)}
                {s.effort ? ` · ${s.effort}` : ''}
              </td>
              <td className="numeric hidden px-2 py-2 text-right text-xs text-ink-tertiary @lg:table-cell">{s.requests}</td>
              <td className="numeric hidden whitespace-nowrap px-2 py-2 text-right text-xs text-ink-tertiary @xl:table-cell">
                {s.tokens.cacheWrite + s.tokens.cacheRead === 0 && s.pricedFrom === 'cli' ? '—' : `${tokens(s.tokens.cacheWrite)} / ${tokens(s.tokens.cacheRead)}`}
              </td>
              <td className="numeric px-2 py-2 text-right text-xs text-ink-tertiary">{tokens(s.tokens.output)}</td>
              <td className="numeric whitespace-nowrap px-4 py-2 text-right text-ink">
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
    </Card>
  );
}

function WeekList({ weeks, current, onPick }: { weeks: UsageWeek[]; current: Date; onPick: (week: Date) => void }) {
  if (weeks.length === 0) return <p className="text-sm text-ink-tertiary">No recorded spend yet.</p>;
  const max = Math.max(...weeks.map((w) => w.costUsd)) || 1;
  return (
    <Card className="divide-y divide-line-subtle overflow-hidden">
      {weeks.map((w) => {
        const start = new Date(w.weekStart);
        const active = start.getTime() === current.getTime();
        return (
          <button
            key={w.weekStart}
            type="button"
            onClick={() => onPick(start)}
            aria-pressed={active}
            className={cn('grid w-full grid-cols-[9.5rem_1fr_auto] items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-hover', active && 'bg-selected')}
          >
            <span className={active ? 'font-medium text-ink' : 'text-ink-secondary'}>{weekLabel(start)}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-neutral-subtle">
              <span className="block h-full rounded-full bg-tone-accent-solid" style={{ width: `${(w.costUsd / max) * 100}%` }} />
            </span>
            <span className="numeric w-[8.5rem] text-right text-xs text-ink">
              {money(w.costUsd)} <span className="text-ink-tertiary">· {w.sessions} sessions</span>
            </span>
          </button>
        );
      })}
    </Card>
  );
}
