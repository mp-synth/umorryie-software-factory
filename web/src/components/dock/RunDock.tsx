import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useMemo, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useMatch } from 'react-router-dom';
import type { Run } from '@factory/shared';
import { AgentGlyph } from '@/components/AgentGlyph';
import { Count, EmptyState, IconButton, LiveDot, Spinner, Tooltip } from '@/components/ui';
import { DOCK_DEFAULT_WIDTH, DOCK_MIN_WIDTH, layout, useLayout } from '@/lib/layout';
import { useInitiative } from '@/lib/queries';
import { isRunInFlight, runKind } from '@/lib/status';
import { cn, pad2 } from '@/lib/utils';
import { DetailSwitch } from './DetailSwitch';
import { Feed, type FeedHandle } from './Feed';
import { RunView, runLabel } from './RunView';
import { useRunDock } from './use-run-dock';

/** Room the main panel keeps beside the live panel; below that the live panel floats over the page. */
const MIN_PAGE_PX = 440;

/** Oldest first, so the newest agent is at the bottom; runs still waiting for a slot come last. */
function chronological(a: Run, b: Run): number {
  const qa = a.status === 'queued';
  const qb = b.status === 'queued';
  if (qa !== qb) return qa ? 1 : -1;
  return Date.parse(a.startedAt ?? a.queuedAt) - Date.parse(b.startedAt ?? b.queuedAt);
}

/**
 * The live panel. On an initiative page it is open by default and shows every agent's activity in order, newest at the
 * bottom; it collapses to a rail that still shows who is running. Elsewhere it appears only for a run you open.
 */
export function RunDock() {
  const { dockOpen } = useLayout();
  const initiativeId = useMatch('/i/:id')?.params.id ?? null;
  const { runId, watch, back } = useRunDock();
  if (runId) {
    return (
      <DockFrame>
        <RunView key={runId} runId={runId} linkInitiative={!initiativeId} onBack={initiativeId ? back : undefined} onClose={back} />
      </DockFrame>
    );
  }
  if (!initiativeId) return null;
  return dockOpen ? <FeedDock initiativeId={initiativeId} onDetails={watch} /> : <FeedRail initiativeId={initiativeId} onDetails={watch} />;
}

function DockFrame({ children }: { children: ReactNode }) {
  const { dockWidth } = useLayout();
  return (
    <aside
      aria-label="Live agents"
      className="relative flex shrink-0 animate-slide-in-right flex-col overflow-hidden rounded-xl border border-line-subtle bg-panel shadow-sm [container:page/inline-size] max-[1100px]:absolute max-[1100px]:inset-y-2 max-[1100px]:right-2 max-[1100px]:z-40 max-[1100px]:shadow-dialog"
      style={{ width: dockWidth, maxWidth: `calc(100vw - ${MIN_PAGE_PX}px)`, minWidth: Math.min(DOCK_MIN_WIDTH, window.innerWidth - 16) }}
    >
      <ResizeHandle />
      {children}
    </aside>
  );
}

function ResizeHandle() {
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    const right = handle.parentElement!.getBoundingClientRect().right;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const max = window.innerWidth - MIN_PAGE_PX;
      layout.set({ dockWidth: Math.max(DOCK_MIN_WIDTH, Math.min(max, Math.round(right - ev.clientX))) }, false);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      layout.set({});
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the live panel"
      title="Drag to resize, double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => layout.set({ dockWidth: DOCK_DEFAULT_WIDTH })}
      className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-[var(--line-accent)] active:bg-[var(--line-accent)]"
    />
  );
}

function useInitiativeRuns(initiativeId: string): Run[] | undefined {
  const { data } = useInitiative(initiativeId);
  return useMemo(() => data && [...data.runs].sort(chronological), [data]);
}

function FeedDock({ initiativeId, onDetails }: { initiativeId: string; onDetails: (id: string) => void }) {
  const runs = useInitiativeRuns(initiativeId);
  const feed = useRef<FeedHandle>(null);
  const live = (runs ?? []).filter(isRunInFlight);
  const running = live.filter((r) => r.status === 'running').length;
  return (
    <DockFrame>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line-subtle pl-4 pr-2">
        <h2 className="flex shrink-0 items-center gap-2 text-sm font-medium text-ink">
          {running > 0 && <LiveDot />}
          Live agents
          {live.length > 0 && <Count n={live.length} tone="active" />}
        </h2>
        <span className="flex-1" />
        <DetailSwitch />
        <IconButton label="Hide the live agents panel" shortcut="]" icon={<PanelRightClose />} onClick={() => layout.set({ dockOpen: false })} tooltipSide="bottom" />
      </div>
      {live.length > 0 && (
        <div className="no-scrollbar flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line-subtle px-3 py-1.5">
          <span className="mr-1 shrink-0 text-xs text-ink-tertiary">Jump to</span>
          {live.map((r) => (
            <Tooltip key={r.id} side="bottom" content={`${runKind[r.kind].agent} · ${runLabel(r)}${r.status === 'queued' ? ' · waiting for a slot' : ''}`}>
              <button
                type="button"
                onClick={() => feed.current?.jumpTo(r.id)}
                className="flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-neutral-subtle px-2 text-xs text-ink-secondary transition-colors hover:bg-neutral-subtle-hover hover:text-ink"
              >
                {runKind[r.kind].label}
                {r.ticketSeq ? <span className="numeric">{pad2(r.ticketSeq)}</span> : null}
                {r.status === 'running' ? <LiveDot /> : <span className="size-1.5 rounded-full border border-ink-tertiary" />}
              </button>
            </Tooltip>
          ))}
        </div>
      )}
      {!runs ? (
        <div className="grid flex-1 place-items-center">
          <Spinner className="size-5" />
        </div>
      ) : runs.length === 0 ? (
        <EmptyState title="No agent has run yet" className="my-auto">
          Each agent shows up here, live, the moment it starts: the planner first, then an executor, checks and a reviewer for every ticket.
        </EmptyState>
      ) : (
        <Feed ref={feed} runs={runs} onDetails={onDetails} />
      )}
    </DockFrame>
  );
}

function FeedRail({ initiativeId, onDetails }: { initiativeId: string; onDetails: (id: string) => void }) {
  const live = (useInitiativeRuns(initiativeId) ?? []).filter(isRunInFlight);
  const running = live.filter((r) => r.status === 'running').length;
  return (
    <aside aria-label="Live agents" className="flex w-12 shrink-0 flex-col items-center gap-2 rounded-xl border border-line-subtle bg-panel py-2 shadow-sm">
      <IconButton label="Show the live agents panel" shortcut="]" icon={<PanelRightOpen />} onClick={() => layout.set({ dockOpen: true })} tooltipSide="left" />
      {running > 0 && <Count n={running} tone="active" />}
      <div className="no-scrollbar flex min-h-0 flex-col items-center gap-1.5 overflow-y-auto">
        {live.map((r) => (
          <Tooltip key={r.id} side="left" content={`${runKind[r.kind].agent} · ${runLabel(r)}${r.status === 'queued' ? ' · waiting for a slot' : ''}`}>
            <button type="button" onClick={() => onDetails(r.id)} className={cn('relative rounded-lg')} aria-label={`Open ${runKind[r.kind].agent}`}>
              <AgentGlyph kind={r.kind} />
              {r.status === 'running' && <LiveDot className="absolute -right-0.5 -top-0.5" />}
            </button>
          </Tooltip>
        ))}
      </div>
    </aside>
  );
}
