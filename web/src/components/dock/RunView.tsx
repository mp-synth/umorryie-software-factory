import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowDown, ChevronLeft, Copy, Square, Terminal, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Run, RunEvent } from '@factory/shared';
import { AgentGlyph } from '@/components/AgentGlyph';
import { Markdown } from '@/components/Markdown';
import { RunBadge, VerdictBadge } from '@/components/StatusBadge';
import { Button, Callout, Chip, IconButton, LiveDot, Spinner, Tabs, Tooltip, confirmAction } from '@/components/ui';
import { api } from '@/lib/api';
import { useNow, useRunEvents } from '@/lib/live';
import { usePreferences } from '@/lib/preferences';
import { isRunInFlight, runKind } from '@/lib/status';
import { copyWithToast, toastError, toastSuccess } from '@/lib/toasts';
import { cn, money, pad2, runDuration, shortPath, tokens } from '@/lib/utils';
import { DetailSwitch } from './DetailSwitch';
import { EventList } from './EventList';
import { useStickToBottom } from './use-stick-to-bottom';

export const runLabel = (r: Run): string => (r.ticketSeq ? `${pad2(r.ticketSeq)} · ${r.ticketTitle}` : (r.initiativeTitle ?? 'Whole initiative'));

type Tab = 'activity' | 'output' | 'prompt';

export function RunView({ runId, linkInitiative, onBack, onClose }: { runId: string; linkInitiative: boolean; onBack?: () => void; onClose: () => void }) {
  const { data: run } = useQuery({ queryKey: ['run', runId], queryFn: () => api.run(runId), refetchInterval: (q) => (q.state.data?.status === 'running' ? 5000 : false) });
  const { events, ready } = useRunEvents(runId);
  const live = !!run && isRunInFlight(run);
  const now = useNow(1000, live);
  const [tab, setTab] = useState<Tab>('activity');
  const cancel = useMutation({ mutationFn: () => api.cancelRun(runId), onSuccess: toastSuccess('Stop requested'), onError: toastError });
  useEffect(() => {
    if (run && !live && run.outputMd && tab === 'activity' && events.length === 0 && ready) setTab('output');
  }, [run, live, events.length, ready, tab]);

  const header = (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line-subtle px-3">
      {onBack ? (
        <Button size="sm" variant="ghost" icon={<ChevronLeft />} onClick={onBack}>
          All agents
        </Button>
      ) : (
        <span className="eyebrow px-1">Agent run</span>
      )}
      <span className="flex-1" />
      {tab === 'activity' && <DetailSwitch />}
      <IconButton label="Close the run" icon={<X />} onClick={onClose} tooltipSide="bottom" />
    </div>
  );

  if (!run) {
    return (
      <>
        {header}
        <div className="grid flex-1 place-items-center">
          <Spinner className="size-5" />
        </div>
      </>
    );
  }
  const k = runKind[run.kind];
  const resume = run.sessionId && run.cwd ? `cd ${run.cwd} && claude --resume ${run.sessionId}` : null;
  const stop = async () => {
    const ok = await confirmAction({
      title: `Stop the ${k.agent.toLowerCase()}?`,
      description: 'It ends mid-task. Whatever it already committed stays, and you can run the step again.',
      confirmLabel: 'Stop the agent',
      danger: true,
    });
    if (ok) cancel.mutate();
  };

  return (
    <>
      {header}
      <div className="shrink-0 border-b border-line-subtle px-5 pb-4 pt-4">
        <div className="flex items-start gap-3">
          <AgentGlyph kind={run.kind} size="lg" />
          <div className="min-w-0 flex-1">
            <Tooltip content={k.description} side="bottom" align="start">
              <h2 className="heading w-fit text-lg text-ink">{k.agent}</h2>
            </Tooltip>
            <div className="mt-0.5 truncate text-sm text-ink-secondary">
              {linkInitiative ? (
                <Link to={`/i/${run.initiativeId}`} className="hover:text-ink hover:underline" title={`Open ${run.initiativeTitle ?? 'the initiative'}`}>
                  {runLabel(run)}
                </Link>
              ) : (
                runLabel(run)
              )}
            </div>
          </div>
          {live && (
            <Button size="sm" variant="outline" className="text-ink-bad" icon={<Square />} loading={cancel.isPending} onClick={stop}>
              Stop
            </Button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <RunBadge status={run.status} />
          <VerdictBadge verdict={run.verdict} />
          {run.model && (
            <Chip mono>
              {run.model}
              {run.effort ? ` · ${run.effort}` : ''}
            </Chip>
          )}
          {run.round > 0 && <Chip>round {run.round}</Chip>}
          <Chip>{run.trigger === 'auto' ? 'started by autopilot' : 'started by you'}</Chip>
          {run.roleSha && <Chip mono title="The role prompt's version">prompt {run.roleSha.slice(0, 8)}</Chip>}
          {run.claudeVersion && <Chip mono>{run.claudeVersion}</Chip>}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 @sm:grid-cols-4">
          <Fact label="Duration" value={runDuration(run, now)} />
          <Fact label="Cost" value={money(run.costUsd)} />
          <Fact label="Tokens in / out" value={`${tokens(run.inputTokens)} / ${tokens(run.outputTokens)}`} />
          <Fact label="Turns" value={run.numTurns ?? '—'} />
        </dl>
        {run.error && (
          <Callout tone="bad" className="mt-3" title="What went wrong">
            <span className="break-words">{run.error}</span>
          </Callout>
        )}
      </div>
      <div className="flex shrink-0 items-end gap-2 px-3">
        <Tabs
          label="Run details"
          value={tab}
          onChange={setTab}
          className="flex-1 border-b-0"
          items={[
            { value: 'activity', label: <span className="flex items-center gap-1.5">Activity {live && <LiveDot />}</span> },
            { value: 'output', label: 'Output' },
            { value: 'prompt', label: 'Prompt' },
          ]}
        />
        {resume && (
          <Button size="xs" variant="ghost" className="mb-1.5" icon={<Terminal />} onClick={() => copyWithToast(resume, 'Resume command copied')}>
            Copy resume command
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 border-t border-line-subtle">
        {tab === 'activity' && <Activity run={run} events={events} ready={ready} />}
        {tab === 'output' && (
          <div className="h-full overflow-y-auto px-5 py-5">
            {run.outputMd ? <Markdown>{run.outputMd}</Markdown> : <p className="text-sm text-ink-tertiary">{live ? 'The agent has not written its output file yet.' : 'This run produced no output file.'}</p>}
          </div>
        )}
        {tab === 'prompt' && <PromptTab run={run} />}
      </div>
    </>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-sunken px-2.5 py-2">
      <dt className="truncate text-2xs text-ink-tertiary">{label}</dt>
      <dd className="numeric mt-0.5 truncate text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}

function Activity({ run, events, ready }: { run: Run; events: RunEvent[]; ready: boolean }) {
  const { activityDetail } = usePreferences();
  const { scroller, content, atBottom, toBottom, onScroll, onWheel } = useStickToBottom();
  const live = run.status === 'running';
  return (
    <div className="relative h-full">
      <div ref={scroller} onScroll={onScroll} onWheel={onWheel} className="h-full overflow-y-auto bg-sunken/50 px-4 py-4">
        <div ref={content}>
          {!ready && <Spinner />}
          {ready && events.length === 0 && <p className="text-sm text-ink-tertiary">{run.status === 'queued' ? 'Queued: waiting for a free agent slot.' : 'No activity recorded.'}</p>}
          <EventList events={events} live={live} detail={activityDetail} />
          {live && <Working />}
        </div>
      </div>
      {!atBottom && <JumpToLatest onClick={toBottom} />}
    </div>
  );
}

export function Working() {
  return (
    <div className="mt-3 flex items-center gap-2 px-1 text-xs text-ink-alert">
      <LiveDot /> Working…
    </div>
  );
}

export function JumpToLatest({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-3 left-1/2 flex -translate-x-1/2 animate-fade-in items-center gap-1.5 rounded-full border border-line-subtle bg-raised px-3 py-1 text-xs font-medium text-ink shadow-popover hover:bg-hover"
    >
      <ArrowDown className="size-3.5" /> Jump to latest
    </button>
  );
}

function PromptTab({ run }: { run: Run }) {
  const rows: [string, string | null][] = [
    ['Working directory', run.cwd],
    ['Run folder', run.runDir],
    ['Output file', run.outputPath],
    ['Session', run.sessionId],
  ];
  return (
    <div className="h-full space-y-4 overflow-y-auto px-5 py-5">
      <p className="text-sm leading-relaxed text-ink-secondary">
        Every agent starts as a fresh <code className="text-ink">claude -p</code> process with no prior conversation. This header plus the role instructions in{' '}
        <code className="text-ink">agents/</code> is everything it is told; the rest it reads from files.
      </p>
      <pre className="whitespace-pre-wrap rounded-lg border border-line-subtle bg-sunken p-4 font-mono text-xs leading-relaxed text-ink-secondary">{run.prompt ?? '—'}</pre>
      <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-tertiary">{k}</dt>
            <dd className={cn('flex min-w-0 items-center gap-1.5 font-mono text-xs', v ? 'text-ink' : 'text-ink-tertiary')}>
              <span className="truncate" title={v ?? ''}>
                {shortPath(v) || '—'}
              </span>
              {v && (
                <button type="button" className="shrink-0 text-ink-tertiary hover:text-ink" onClick={() => copyWithToast(v)} aria-label={`Copy ${k}`}>
                  <Copy className="size-3.5" />
                </button>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
