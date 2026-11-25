import { useQuery } from '@tanstack/react-query';
import { Bot, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RUN_KINDS, type RunKind } from '@factory/shared';
import { AgentGlyph } from '@/components/AgentGlyph';
import { useRunDock } from '@/components/dock/use-run-dock';
import { usePageMeta } from '@/components/shell/page-meta';
import { RunBadge, VerdictBadge } from '@/components/StatusBadge';
import { Button, Card, EmptyState, Input, Page, PageHeader, ProgressBar, Segmented, Select, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { poolNote, poolSize, useCapacity, useNow } from '@/lib/live';
import { runKind } from '@/lib/status';
import { ago, money, pad2, runDuration, tokens } from '@/lib/utils';

export function AgentsPage() {
  usePageMeta('Agents');
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<RunKind | 'any'>('any');
  const { data: runs = [], isLoading } = useQuery({ queryKey: ['runs', filter], queryFn: () => api.runs({ active: filter === 'active', limit: 300 }), refetchInterval: 20_000 });
  const dock = useRunDock();
  const now = useNow(1000, runs.some((r) => r.status === 'running'));
  const capacity = useCapacity();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return runs.filter((r) => (kind === 'any' || r.kind === kind) && (!q || `${runKind[r.kind].agent} ${r.initiativeTitle ?? ''} ${r.ticketTitle ?? ''} ${r.model ?? ''}`.toLowerCase().includes(q)));
  }, [runs, query, kind]);

  return (
    <Page width="wide">
      <PageHeader
        title="Agents"
        description="Every agent run, newest first. Each is a fresh Claude Code process that reads files and writes one output file. Click a run to open it."
        actions={
          <Segmented
            label="Which runs"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'active', label: 'Running and queued' },
              { value: 'all', label: 'History' },
            ]}
          />
        }
      />

      {capacity && (
        <Card className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5">
          <div className="min-w-[14rem] flex-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-ink">
                <span className="numeric">{capacity.running}</span> of <span className="numeric">{capacity.limit}</span> agent slots in use
              </span>
              {capacity.queued > 0 && <span className="text-xs text-ink-warn">{capacity.queued} waiting for a slot</span>}
            </div>
            <ProgressBar className="mt-2" label="Agent slots in use" value={capacity.limit ? capacity.running / capacity.limit : 0} tone={capacity.queued ? 'warn' : 'active'} />
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <div>
              <dt className="text-ink-tertiary">Pool</dt>
              <dd className="text-ink">{poolSize(capacity)}</dd>
            </div>
            <div>
              <dt className="text-ink-tertiary">Initiatives with work</dt>
              <dd className="numeric text-ink">{capacity.lanes}</dd>
            </div>
            <div>
              <dt className="text-ink-tertiary">Machine load</dt>
              <dd className="numeric text-ink">{capacity.loadPerCore} per core</dd>
            </div>
          </dl>
          {poolNote(capacity) && <p className="basis-full text-xs text-ink-warn">The pool is {poolNote(capacity)}.</p>}
        </Card>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input size="sm" leading={<Search />} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by agent, initiative, ticket or model" className="w-72" aria-label="Filter runs" />
        <div className="w-48">
          <Select size="sm" value={kind} onChange={(e) => setKind(e.target.value as RunKind | 'any')} aria-label="Agent kind">
            <option value="any">Every kind of agent</option>
            {RUN_KINDS.map((k) => (
              <option key={k} value={k}>
                {runKind[k].agent}
              </option>
            ))}
          </Select>
        </div>
        <span className="ml-auto text-xs text-ink-tertiary">
          {shown.length} run{shown.length === 1 ? '' : 's'}
        </span>
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((n) => (
              <Skeleton key={n} className="h-10" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<Bot />}
            title={runs.length ? 'No run matches' : filter === 'active' ? 'No agent is running' : 'No runs yet'}
            actions={
              !runs.length &&
              filter === 'active' && (
                <Button variant="outline" onClick={() => setFilter('all')}>
                  Show the history
                </Button>
              )
            }
          >
            {runs.length ? 'Clear the filters to see every run.' : filter === 'active' ? 'Agents show up here the moment one starts.' : 'Create an initiative to start the first planner.'}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-line-subtle text-xs text-ink-tertiary">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Agent</th>
                  <th className="px-2 py-2.5 font-medium">Working on</th>
                  <th className="px-2 py-2.5 font-medium">Status</th>
                  <th className="px-2 py-2.5 font-medium">Verdict</th>
                  <th className="hidden px-2 py-2.5 font-medium @lg:table-cell">Model</th>
                  <th className="px-2 py-2.5 text-right font-medium">Duration</th>
                  <th className="hidden px-2 py-2.5 text-right font-medium @xl:table-cell">Tokens in / out</th>
                  <th className="px-2 py-2.5 text-right font-medium">Cost</th>
                  <th className="px-4 py-2.5 text-right font-medium">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {shown.map((r) => (
                  <tr key={r.id} onClick={() => dock.watch(r.id)} className="cursor-pointer transition-colors hover:bg-hover">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <AgentGlyph kind={r.kind} />
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              dock.watch(r.id);
                            }}
                            className="block font-medium text-ink"
                          >
                            {runKind[r.kind].agent}
                          </button>
                          <div className="text-xs text-ink-tertiary">
                            {r.trigger === 'auto' ? 'autopilot' : 'by you'}
                            {r.round ? ` · round ${r.round}` : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="max-w-[22rem] px-2 py-2.5">
                      <Link to={`/i/${r.initiativeId}`} onClick={(e) => e.stopPropagation()} className="block truncate text-ink hover:underline">
                        {r.initiativeTitle}
                      </Link>
                      {r.ticketSeq && (
                        <div className="truncate text-xs text-ink-tertiary">
                          {pad2(r.ticketSeq)} · {r.ticketTitle}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <RunBadge status={r.status} />
                    </td>
                    <td className="px-2 py-2.5">
                      <VerdictBadge verdict={r.verdict} />
                    </td>
                    <td className="hidden px-2 py-2.5 font-mono text-xs text-ink-secondary @lg:table-cell">{r.model ?? '—'}</td>
                    <td className="numeric px-2 py-2.5 text-right text-ink-secondary">{runDuration(r, now)}</td>
                    <td className="numeric hidden px-2 py-2.5 text-right text-ink-tertiary @xl:table-cell">{r.inputTokens ? `${tokens(r.inputTokens)} / ${tokens(r.outputTokens)}` : '—'}</td>
                    <td className="numeric px-2 py-2.5 text-right text-ink-secondary">{money(r.costUsd)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs text-ink-tertiary">{ago(r.startedAt ?? r.queuedAt, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
