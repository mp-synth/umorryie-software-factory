import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useNow } from '@/lib/live';
import { runKind } from '@/lib/status';
import { ago, cn, money, pad2, runDuration, tokens } from '@/lib/utils';
import { RunPill, VerdictPill } from '@/components/StatusPill';
import { useRunDock } from '@/components/RunDock';
import { Card, EmptyState, Segmented } from '@/components/ui';

export function AgentsPage() {
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const { data: runs = [] } = useQuery({
    queryKey: ['runs', filter],
    queryFn: () => api.runs({ active: filter === 'active', limit: 300 }),
    refetchInterval: 20_000,
  });
  const dock = useRunDock();
  const now = useNow(1000, runs.some((r) => r.status === 'running'));

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-8 @lg:px-8">
      <header className="mb-6 flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-50">Agents</h1>
          <p className="mt-1 text-sm text-zinc-500">Every agent run, newest first. Each is a fresh Claude Code process that read files and wrote one file.</p>
        </div>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'active', label: 'Running & queued' },
            { value: 'all', label: 'History' },
          ]}
        />
      </header>
      <Card>
        {runs.length === 0 ? (
          <EmptyState icon={<Activity />} title={filter === 'active' ? 'No agents running' : 'No runs yet'}>
            {filter === 'active' ? 'Agents show up here the moment they start.' : 'Create an initiative to start the planner.'}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead>
                <tr className="border-b border-line text-2xs uppercase tracking-wider text-zinc-600">
                  <th className="px-4 py-2 font-medium">Agent</th>
                  <th className="px-2 py-2 font-medium">Working on</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Verdict</th>
                  <th className="hidden px-2 py-2 font-medium @lg:table-cell">Model</th>
                  <th className="px-2 py-2 text-right font-medium">Duration</th>
                  <th className="hidden px-2 py-2 text-right font-medium @xl:table-cell">Tokens</th>
                  <th className="px-2 py-2 text-right font-medium">Cost</th>
                  <th className="px-4 py-2 text-right font-medium">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {runs.map((r) => {
                  const k = runKind[r.kind];
                  return (
                    <tr key={r.id} onClick={() => dock.watch(r.id)} className="cursor-pointer transition-colors hover:bg-white/[0.02]">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className={cn('grid h-7 w-7 place-items-center rounded-lg border border-line bg-surface-2', k.color)}>
                            <k.icon className="h-3.5 w-3.5" />
                          </span>
                          <div>
                            <div className="text-zinc-200">{k.agent}</div>
                            <div className="text-2xs text-zinc-600">{r.trigger === 'auto' ? 'autopilot' : 'manual'}{r.round ? ` · round ${r.round}` : ''}</div>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[340px] px-2 py-2.5">
                        <Link to={`/i/${r.initiativeId}`} onClick={(e) => e.stopPropagation()} className="block truncate text-zinc-300 hover:text-white">
                          {r.initiativeTitle}
                        </Link>
                        {r.ticketSeq && <div className="truncate text-2xs text-zinc-500">{pad2(r.ticketSeq)} · {r.ticketTitle}</div>}
                      </td>
                      <td className="px-2 py-2.5"><RunPill status={r.status} /></td>
                      <td className="px-2 py-2.5"><VerdictPill verdict={r.verdict} /></td>
                      <td className="hidden px-2 py-2.5 font-mono text-2xs text-zinc-500 @lg:table-cell">{r.model ?? '—'}</td>
                      <td className="px-2 py-2.5 text-right font-mono text-2xs tabular-nums text-zinc-400">{runDuration(r, now)}</td>
                      <td className="hidden px-2 py-2.5 text-right font-mono text-2xs tabular-nums text-zinc-500 @xl:table-cell">{r.inputTokens ? `${tokens(r.inputTokens)}/${tokens(r.outputTokens)}` : '—'}</td>
                      <td className="px-2 py-2.5 text-right font-mono text-2xs tabular-nums text-zinc-400">{money(r.costUsd)}</td>
                      <td className="px-4 py-2.5 text-right text-2xs text-zinc-500">{ago(r.startedAt ?? r.queuedAt, now)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
