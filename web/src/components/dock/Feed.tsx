import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FileText } from 'lucide-react';
import { forwardRef, useImperativeHandle, useMemo, useState } from 'react';
import type { Run } from '@factory/shared';
import { AgentGlyph } from '@/components/AgentGlyph';
import { RunBadge, VerdictBadge } from '@/components/StatusBadge';
import { IconButton, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { useNow, useRunEvents } from '@/lib/live';
import { usePreferences } from '@/lib/preferences';
import { isRunInFlight, replacedRunIds, runKind } from '@/lib/status';
import { cn, runDuration } from '@/lib/utils';
import { EventList } from './EventList';
import { JumpToLatest, Working, runLabel } from './RunView';
import { useStickToBottom } from './use-stick-to-bottom';

/** Each live stream holds one of the browser's ~6 connections to the server, so only this many open on their own. */
const MAX_AUTO_STREAMS = 3;

export type FeedHandle = { jumpTo: (id: string) => void };

/**
 * Every agent of the initiative as one log: a block per run, oldest at the top. Running agents (and the newest run) are
 * open; finished ones fold to their header so the path planner → executor → reviewer stays readable. The view sticks to
 * the bottom while you are there, and stays put once you scroll up.
 */
export const Feed = forwardRef<FeedHandle, { runs: Run[]; onDetails: (id: string) => void }>(function Feed({ runs, onDetails }, ref) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const { scroller, content, atBottom, release, toBottom, onScroll, onWheel } = useStickToBottom();
  const newest = runs[runs.length - 1]?.id;
  const replaced = useMemo(() => replacedRunIds(runs), [runs]);
  const streaming = new Set(
    runs
      .filter((r) => r.status === 'running')
      .slice(-MAX_AUTO_STREAMS)
      .map((r) => r.id),
  );
  const isOpen = (r: Run) => toggled[r.id] ?? (streaming.has(r.id) || r.id === newest);

  useImperativeHandle(ref, () => ({
    jumpTo: (id) => {
      release();
      setToggled((t) => ({ ...t, [id]: true }));
      requestAnimationFrame(() => document.getElementById(`feed-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    },
  }));

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={onScroll} onWheel={onWheel} className="h-full overflow-y-auto bg-sunken/50">
        <div ref={content} className="pb-4">
          {runs.map((r) => (
            <RunBlock
              key={r.id}
              run={r}
              replaced={replaced.has(r.id)}
              open={isOpen(r)}
              onToggle={() => {
                release();
                setToggled((t) => ({ ...t, [r.id]: !isOpen(r) }));
              }}
              onDetails={() => onDetails(r.id)}
            />
          ))}
        </div>
      </div>
      {!atBottom && <JumpToLatest onClick={toBottom} />}
    </div>
  );
});

function RunBlock({ run, replaced, open, onToggle, onDetails }: { run: Run; replaced: boolean; open: boolean; onToggle: () => void; onDetails: () => void }) {
  const k = runKind[run.kind];
  const now = useNow(1000, run.status === 'running');
  return (
    <section id={`feed-${run.id}`} className="scroll-mt-1">
      <div className="sticky top-0 z-[1] flex items-center gap-1 border-b border-line-subtle bg-panel/95 pr-2 backdrop-blur">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          title={replaced ? `A later ${k.agent.toLowerCase()} run replaced this one` : undefined}
          className={cn('flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-3 text-left', replaced && 'opacity-55 hover:opacity-85')}
        >
          <ChevronRight className={cn('size-3.5 shrink-0 text-ink-tertiary transition-transform', open && 'rotate-90')} />
          <AgentGlyph kind={run.kind} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">
              {k.agent}
              {run.round > 0 && run.kind !== 'gate' && <span className="font-normal text-ink-tertiary"> · round {run.round}</span>}
            </span>
            <span className="block truncate text-xs text-ink-tertiary">{run.ticketSeq ? runLabel(run) : 'Whole initiative'}</span>
          </span>
          <RunBadge status={run.status} replaced={replaced} />
          <VerdictBadge verdict={run.verdict} />
          <span className="numeric w-12 shrink-0 text-right text-xs text-ink-tertiary">{run.status === 'queued' ? '' : runDuration(run, now)}</span>
        </button>
        <IconButton label="Output, prompt and cost" icon={<FileText />} size="xs" onClick={onDetails} tooltipSide="left" />
      </div>
      {open && (
        <div className="ml-[1.4rem] border-l border-line-subtle py-2 pl-3 pr-3">
          <BlockEvents run={run} />
        </div>
      )}
    </section>
  );
}

function BlockEvents({ run }: { run: Run }) {
  const { activityDetail } = usePreferences();
  const running = run.status === 'running';
  const stream = useRunEvents(running ? run.id : null);
  const past = useQuery({ queryKey: ['run-events', run.id], queryFn: () => api.runEvents(run.id), enabled: !isRunInFlight(run), staleTime: 60_000 });
  if (run.status === 'queued') return <p className="py-0.5 text-xs text-ink-tertiary">Waiting for a free agent slot.</p>;
  const events = running ? stream.events : (past.data ?? []);
  const loading = running ? !stream.ready : past.isPending;
  if (events.length === 0) return loading ? <Spinner className="size-3.5" /> : <p className="py-0.5 text-xs text-ink-tertiary">No activity recorded.</p>;
  return (
    <>
      <EventList events={events} live={running} detail={activityDetail} />
      {running && <Working />}
    </>
  );
}
