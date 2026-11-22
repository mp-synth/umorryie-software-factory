import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  FilePlus2,
  FileText,
  FolderSearch,
  Globe,
  PanelRightClose,
  PanelRightOpen,
  PencilLine,
  Search,
  Sparkles,
  Square,
  Terminal,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Link, useMatch, useSearchParams } from 'react-router-dom';
import type { Run, RunEvent } from '@factory/shared';
import { api } from '@/lib/api';
import { useNow, useRunEvents } from '@/lib/live';
import { runKind, isRunInFlight } from '@/lib/status';
import { copyWithToast, toastError, toastSuccess } from '@/lib/toasts';
import { cn, money, pad2, runDuration, shortPath, tokens } from '@/lib/utils';
import { Markdown } from './Markdown';
import { RunPill, VerdictPill } from './StatusPill';
import { Button, Chip, Segmented, Spinner, LiveDot, Tooltip } from './ui';

const PREFS_KEY = 'factory-run-dock';
const SIDEBAR_PX = 232;
const MIN_PAGE_PX = 420;
const MIN_WIDTH = 380;
const DEFAULT_WIDTH = 540;
/** Each live stream holds one of the browser's ~6 connections to the server, so only this many open on their own. */
const MAX_AUTO_STREAMS = 3;

type DockPrefs = { open: boolean; width: number };

function storedPrefs(): DockPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<DockPrefs>;
    return { open: p.open !== false, width: typeof p.width === 'number' ? Math.max(MIN_WIDTH, p.width) : DEFAULT_WIDTH };
  } catch {
    return { open: true, width: DEFAULT_WIDTH };
  }
}

let prefs = storedPrefs();
const listeners = new Set<() => void>();

function setPrefs(next: Partial<DockPrefs>, persist = true): void {
  prefs = { ...prefs, ...next };
  if (persist) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Storage unavailable: the choice holds for this tab only.
    }
  }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

const useDockPrefs = (): DockPrefs => useSyncExternalStore(subscribe, () => prefs);

/** `?run=<id>` opens one run's details in the panel; without it an initiative page shows every agent's activity. */
export function useRunDock() {
  const [params, setParams] = useSearchParams();
  const setRun = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('run', id);
    else next.delete('run');
    setParams(next);
  };
  return {
    runId: params.get('run'),
    watch: (id: string) => {
      setPrefs({ open: true });
      setRun(id);
    },
    back: () => setRun(null),
  };
}

const runLabel = (r: Run): string => (r.ticketSeq ? `[${pad2(r.ticketSeq)}] ${r.ticketTitle}` : (r.initiativeTitle ?? ''));

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
 * In a window too narrow for both (sidebar + MIN_PAGE_PX + MIN_WIDTH = 1032px) it floats over the page.
 */
export function RunDock() {
  const { open } = useDockPrefs();
  const initiativeId = useMatch('/i/:id')?.params.id ?? null;
  const { runId, watch, back } = useRunDock();

  if (runId) {
    return (
      <DockFrame>
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
          {initiativeId ? (
            <Button size="xs" variant="ghost" icon={<ChevronLeft className="h-3.5 w-3.5" />} onClick={back}>
              All agents
            </Button>
          ) : (
            <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Agent run</span>
          )}
          <span className="flex-1" />
          <Tooltip side="bottom" content="Close">
            <button onClick={back} aria-label="Close run" className="rounded-md p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200">
              <X className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>
        <RunView key={runId} runId={runId} linkInitiative={!initiativeId} />
      </DockFrame>
    );
  }
  if (!initiativeId) return null;
  return open ? <FeedDock initiativeId={initiativeId} onDetails={watch} /> : <FeedRail initiativeId={initiativeId} onDetails={watch} />;
}

function DockFrame({ children }: { children: ReactNode }) {
  const { width } = useDockPrefs();
  return (
    <aside
      aria-label="Live agents"
      className="relative flex shrink-0 flex-col border-l border-line-strong bg-drawer max-[1032px]:absolute max-[1032px]:inset-y-0 max-[1032px]:right-0 max-[1032px]:z-40 max-[1032px]:shadow-2xl"
      style={{ width: `min(${width}px, calc(100vw - ${SIDEBAR_PX + MIN_PAGE_PX}px))`, minWidth: MIN_WIDTH }}
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
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const max = window.innerWidth - SIDEBAR_PX - MIN_PAGE_PX;
      setPrefs({ width: Math.max(MIN_WIDTH, Math.min(max, Math.round(window.innerWidth - ev.clientX))) }, false);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      setPrefs({});
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize live panel"
      title="Drag to resize, double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => setPrefs({ width: DEFAULT_WIDTH })}
      className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize transition-colors hover:bg-violet-400/25 active:bg-violet-400/40"
    />
  );
}

function useInitiativeRuns(initiativeId: string): Run[] | undefined {
  const { data } = useQuery({ queryKey: ['initiative', initiativeId], queryFn: () => api.initiative(initiativeId) });
  return useMemo(() => data && [...data.runs].sort(chronological), [data]);
}

function FeedDock({ initiativeId, onDetails }: { initiativeId: string; onDetails: (id: string) => void }) {
  const runs = useInitiativeRuns(initiativeId);
  const feed = useRef<FeedHandle>(null);
  const live = (runs ?? []).filter(isRunInFlight);
  return (
    <DockFrame>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="flex shrink-0 items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-zinc-500">
          {live.some((r) => r.status === 'running') ? <LiveDot /> : <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />}
          Agents
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
          {live.length === 0 && <span className="truncate text-2xs text-zinc-600">{runs?.length ? 'None running now' : ''}</span>}
          {live.map((r) => {
            const k = runKind[r.kind];
            return (
              <Tooltip key={r.id} side="bottom" content={`${k.agent} · ${runLabel(r)}${r.status === 'queued' ? ' · waiting for a slot' : ''}`}>
                <button
                  onClick={() => feed.current?.jumpTo(r.id)}
                  className="flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2 text-2xs text-zinc-400 transition-colors hover:border-line hover:bg-white/[0.04] hover:text-zinc-200"
                >
                  <k.icon className={cn('h-3 w-3', k.color)} />
                  {k.label}
                  {r.ticketSeq ? ` ${pad2(r.ticketSeq)}` : ''}
                  {r.status === 'running' ? <LiveDot /> : <span className="h-1.5 w-1.5 rounded-full border border-zinc-500" />}
                </button>
              </Tooltip>
            );
          })}
        </div>
        <Tooltip side="bottom" content="Hide live panel">
          <button onClick={() => setPrefs({ open: false })} aria-label="Hide live panel" className="rounded-md p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200">
            <PanelRightClose className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>
      {!runs ? (
        <div className="grid flex-1 place-items-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : runs.length === 0 ? (
        <div className="grid flex-1 place-items-center px-10 text-center">
          <div>
            <p className="text-sm text-zinc-300">No agent has run on this initiative yet</p>
            <p className="mt-1 text-xs text-zinc-500">Each agent shows up here, live, the moment it starts.</p>
          </div>
        </div>
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
    <aside aria-label="Live agents" className="flex w-11 shrink-0 flex-col items-center gap-2 border-l border-line bg-sidebar py-3">
      <Tooltip side="left" content="Show live panel">
        <button onClick={() => setPrefs({ open: true })} aria-label="Show live panel" className="rounded-md p-1.5 text-zinc-400 hover:bg-white/5 hover:text-zinc-100">
          <PanelRightOpen className="h-4 w-4" />
        </button>
      </Tooltip>
      {running > 0 && <span className="rounded-full bg-cyan-400/15 px-1.5 text-2xs font-semibold tabular-nums text-cyan-300">{running}</span>}
      <div className="flex min-h-0 flex-col items-center gap-1.5 overflow-y-auto [scrollbar-width:none]">
        {live.map((r) => {
          const k = runKind[r.kind];
          return (
            <Tooltip key={r.id} side="left" content={`${k.agent} · ${runLabel(r)}${r.status === 'queued' ? ' · waiting for a slot' : ''}`}>
              <button onClick={() => onDetails(r.id)} className={cn('relative grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line bg-surface-2', k.color)}>
                <k.icon className="h-3.5 w-3.5" />
                {r.status === 'running' && <LiveDot className="absolute -right-0.5 -top-0.5" />}
              </button>
            </Tooltip>
          );
        })}
      </div>
    </aside>
  );
}

/** Scroll events this soon after the view scrolled itself are its own, even when more content landed in between. */
const OWN_SCROLL_MS = 150;

/**
 * Keeps a scroller pinned to its newest content while you are at the bottom. Only you scrolling up lets go: growth that
 * lands between the view's own scroll and its scroll event must not read as you leaving the bottom.
 */
function useStickToBottom() {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const scrolledSelfAt = useRef(0);
  const [atBottom, setAtBottom] = useState(true);
  const settle = (v: boolean) => {
    stick.current = v;
    setAtBottom(v);
  };
  const pin = () => {
    const el = scroller.current;
    if (!el) return;
    scrolledSelfAt.current = performance.now();
    el.scrollTop = el.scrollHeight;
  };
  useLayoutEffect(() => {
    const inner = content.current;
    if (!inner) return;
    const follow = new ResizeObserver(() => stick.current && pin());
    follow.observe(inner);
    return () => follow.disconnect();
  }, []);
  return {
    scroller,
    content,
    atBottom,
    release: () => settle(false),
    toBottom: () => {
      settle(true);
      pin();
    },
    onScroll: (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) settle(true);
      else if (performance.now() - scrolledSelfAt.current > OWN_SCROLL_MS) settle(false);
    },
    onWheel: (e: React.WheelEvent<HTMLDivElement>) => e.deltaY < 0 && settle(false),
  };
}

type FeedHandle = { jumpTo: (id: string) => void };

/**
 * Every agent of the initiative as one log: a block per run, oldest at the top. Running agents (and the newest run) are
 * open; finished ones fold to their header so the path planner → executor → reviewer stays readable. The view sticks to
 * the bottom while you are there, and stays put once you scroll up.
 */
const Feed = forwardRef<FeedHandle, { runs: Run[]; onDetails: (id: string) => void }>(function Feed({ runs, onDetails }, ref) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const { scroller, content, atBottom, release, toBottom, onScroll, onWheel } = useStickToBottom();

  const newest = runs[runs.length - 1]?.id;
  const streaming = new Set(runs.filter((r) => r.status === 'running').slice(-MAX_AUTO_STREAMS).map((r) => r.id));
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
      <div ref={scroller} onScroll={onScroll} onWheel={onWheel} className="grid-bg h-full overflow-y-auto">
        <div ref={content} className="pb-4">
          {runs.map((r) => (
            <RunBlock
              key={r.id}
              run={r}
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
      {!atBottom && (
        <button
          onClick={toBottom}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line-strong bg-popover px-3 py-1 text-2xs text-zinc-200 shadow-xl hover:bg-surface-3"
        >
          <ArrowDown className="h-3 w-3" /> Latest
        </button>
      )}
    </div>
  );
});

function RunBlock({ run, open, onToggle, onDetails }: { run: Run; open: boolean; onToggle: () => void; onDetails: () => void }) {
  const k = runKind[run.kind];
  const now = useNow(1000, run.status === 'running');
  return (
    <section id={`feed-${run.id}`} className="scroll-mt-1">
      <div className="sticky top-0 z-[1] flex items-center gap-1 border-b border-line/70 bg-drawer/95 pr-2 backdrop-blur">
        <button onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-3 text-left">
          <ChevronRight className={cn('h-3 w-3 shrink-0 text-zinc-600 transition-transform', open && 'rotate-90')} />
          <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-md border border-line bg-surface-2', k.color)}>
            <k.icon className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs text-zinc-200">
              {k.agent}
              {run.round > 0 && run.kind !== 'gate' && <span className="text-zinc-600"> · R{run.round}</span>}
            </span>
            <span className="block truncate text-2xs text-zinc-500">{run.ticketSeq ? runLabel(run) : 'Whole initiative'}</span>
          </span>
          <RunPill status={run.status} />
          <VerdictPill verdict={run.verdict} />
          <span className="w-11 shrink-0 text-right font-mono text-2xs tabular-nums text-zinc-500">{run.status === 'queued' ? '' : runDuration(run, now)}</span>
        </button>
        <Tooltip side="left" content="Output, prompt and cost">
          <button onClick={onDetails} aria-label="Run details" className="rounded-md p-1 text-zinc-600 hover:bg-white/5 hover:text-zinc-200">
            <FileText className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>
      {open && (
        <div className="ml-[22px] border-l border-line py-2 pl-3 pr-3">
          <BlockEvents run={run} />
        </div>
      )}
    </section>
  );
}

function BlockEvents({ run }: { run: Run }) {
  const running = run.status === 'running';
  const stream = useRunEvents(running ? run.id : null);
  const past = useQuery({ queryKey: ['run-events', run.id], queryFn: () => api.runEvents(run.id), enabled: !isRunInFlight(run), staleTime: 60_000 });
  if (run.status === 'queued') return <p className="py-0.5 text-2xs text-zinc-500">Waiting for a free agent slot.</p>;
  const events = running ? stream.events : (past.data ?? []);
  const loading = running ? !stream.ready : past.isPending;
  if (events.length === 0) return loading ? <Spinner className="h-3.5 w-3.5" /> : <p className="py-0.5 text-2xs text-zinc-500">No activity recorded.</p>;
  return (
    <>
      <EventList events={events} live={running} />
      {running && (
        <div className="mt-2 flex items-center gap-2 pl-1 text-2xs text-cyan-300/80">
          <LiveDot /> working…
        </div>
      )}
    </>
  );
}

function RunView({ runId, linkInitiative }: { runId: string; linkInitiative: boolean }) {
  const { data: run } = useQuery({ queryKey: ['run', runId], queryFn: () => api.run(runId), refetchInterval: (q) => (q.state.data?.status === 'running' ? 5000 : false) });
  const { events, ready } = useRunEvents(runId);
  const live = !!run && isRunInFlight(run);
  const now = useNow(1000, live);
  const [tab, setTab] = useState<'activity' | 'output' | 'prompt'>('activity');
  const cancel = useMutation({
    mutationFn: () => api.cancelRun(runId),
    onSuccess: toastSuccess('Cancel requested'),
    onError: toastError,
  });
  useEffect(() => {
    if (run && !live && run.outputMd && tab === 'activity' && events.length === 0 && ready) setTab('output');
  }, [run, live, events.length, ready, tab]);

  if (!run) {
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }
  const k = runKind[run.kind];
  const Icon = k.icon;
  const resume = run.sessionId && run.cwd ? `cd ${run.cwd} && claude --resume ${run.sessionId}` : null;
  const title = runLabel(run);

  return (
    <>
      <div className="border-b border-line px-5 pb-3 pt-4">
        <div className="flex items-start gap-3">
          <div className={cn('mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-surface-2', k.color)}>
            <Icon className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-zinc-100">
              {k.agent}
              <span className="font-normal text-zinc-500">·</span>
              {linkInitiative ? (
                <Link to={`/i/${run.initiativeId}`} title={`Open ${run.initiativeTitle ?? 'the initiative'}`} className="truncate font-normal text-zinc-300 hover:text-white hover:underline">
                  {title}
                </Link>
              ) : (
                <span className="truncate font-normal text-zinc-300">{title}</span>
              )}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <RunPill status={run.status} />
              <VerdictPill verdict={run.verdict} />
              {run.model && <Chip>{run.model}{run.effort ? ` · ${run.effort}` : ''}</Chip>}
              {run.round > 0 && <Chip>round {run.round}</Chip>}
              {run.roleSha && <Chip>prompt {run.roleSha.slice(0, 8)}</Chip>}
              {run.claudeVersion && <Chip>{run.claudeVersion}</Chip>}
              <Chip>{run.trigger === 'auto' ? 'autopilot' : 'manual'}</Chip>
            </div>
          </div>
          {live && (
            <Button size="sm" variant="danger" icon={<Square className="h-3 w-3" />} loading={cancel.isPending} onClick={() => cancel.mutate()}>
              Stop
            </Button>
          )}
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          <Stat label="Duration" value={runDuration(run, now)} />
          <Stat label="Cost" value={money(run.costUsd)} />
          <Stat label="Tokens in / out" value={`${tokens(run.inputTokens)} / ${tokens(run.outputTokens)}`} />
          <Stat label="Turns" value={run.numTurns ?? '—'} />
        </div>
        {run.error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.07] px-3 py-2 text-xs text-rose-200">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span className="break-words">{run.error}</span>
          </div>
        )}
        <div className="mt-3 flex items-center justify-between gap-2">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'activity', label: <>Activity {live && <LiveDot />}</> },
              { value: 'output', label: 'Output' },
              { value: 'prompt', label: 'Prompt' },
            ]}
          />
          {resume && (
            <Button size="xs" variant="ghost" icon={<Terminal className="h-3 w-3" />} onClick={() => copyWithToast(resume, 'Resume command copied')}>
              Copy resume command
            </Button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'activity' && <Activity run={run} events={events} ready={ready} />}
        {tab === 'output' && (
          <div className="h-full overflow-y-auto px-6 py-5">
            {run.outputMd ? <Markdown>{run.outputMd}</Markdown> : <p className="text-xs text-zinc-500">{live ? 'The agent has not written its output file yet.' : 'This run produced no output file.'}</p>}
          </div>
        )}
        {tab === 'prompt' && <PromptTab run={run} />}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
      <div className="truncate text-[10px] uppercase tracking-wider text-zinc-600">{label}</div>
      <div className="mt-0.5 truncate font-mono text-xs text-zinc-200">{value}</div>
    </div>
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
    <div className="h-full space-y-4 overflow-y-auto px-6 py-5">
      <p className="text-xs leading-relaxed text-zinc-500">
        Every agent starts as a fresh <code className="text-zinc-300">claude -p</code> process with no prior conversation. This header plus the role
        instructions in <code className="text-zinc-300">agents/</code> is everything it is told; the rest it reads from files.
      </p>
      <pre className="whitespace-pre-wrap rounded-lg border border-line bg-black/40 p-4 font-mono text-xs leading-relaxed text-zinc-300">{run.prompt ?? '—'}</pre>
      <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-2 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-zinc-500">{k}</dt>
            <dd className="flex min-w-0 items-center gap-1.5 font-mono text-zinc-300">
              <span className="truncate" title={v ?? ''}>{shortPath(v) || '—'}</span>
              {v && (
                <button className="text-zinc-600 hover:text-zinc-300" onClick={() => copyWithToast(v)} aria-label={`Copy ${k}`}>
                  <Copy className="h-3 w-3" />
                </button>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

type Item = { type: 'event'; e: RunEvent } | { type: 'tool'; use: RunEvent; result?: RunEvent } | { type: 'logs'; lines: RunEvent[] };

const TOOL_ICONS: Record<string, LucideIcon> = {
  Read: FileText,
  Bash: Terminal,
  Edit: PencilLine,
  MultiEdit: PencilLine,
  Write: FilePlus2,
  Grep: Search,
  Glob: FolderSearch,
  WebFetch: Globe,
  WebSearch: Globe,
};

function toolSummary(name: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  switch (name) {
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return shortPath(s('file_path'));
    case 'Bash':
      return s('description') ? `${s('description')} — ${s('command').split('\n')[0]}` : s('command').split('\n')[0];
    case 'Grep':
      return `${s('pattern')}${s('path') ? `  in ${shortPath(s('path'))}` : ''}`;
    case 'Glob':
      return s('pattern');
    case 'WebFetch':
      return s('url');
    case 'WebSearch':
      return s('query');
    default:
      return JSON.stringify(input).slice(0, 140);
  }
}

function buildItems(events: RunEvent[]): Item[] {
  const items: Item[] = [];
  const toolIndex = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'tool_use') {
      toolIndex.set(String(e.data.id), items.length);
      items.push({ type: 'tool', use: e });
    } else if (e.type === 'tool_result') {
      const i = toolIndex.get(String(e.data.toolUseId));
      const item = i !== undefined ? items[i] : undefined;
      if (item && item.type === 'tool') item.result = e;
    } else if (e.type === 'log') {
      const last = items[items.length - 1];
      if (last?.type === 'logs') last.lines.push(e);
      else items.push({ type: 'logs', lines: [e] });
    } else {
      items.push({ type: 'event', e });
    }
  }
  return items;
}

function EventList({ events, live }: { events: RunEvent[]; live: boolean }) {
  const items = useMemo(() => buildItems(events), [events]);
  return (
    <ol className="space-y-1.5">
      {items.map((item, i) => (
        <li key={item.type === 'tool' ? item.use.id : item.type === 'logs' ? item.lines[0].id : item.e.id} className="animate-fade-in">
          {item.type === 'tool' ? <ToolRow use={item.use} result={item.result} pending={live && !item.result && i === items.length - 1} /> : item.type === 'logs' ? <LogBlock lines={item.lines} /> : <EventRow e={item.e} />}
        </li>
      ))}
    </ol>
  );
}

function Activity({ run, events, ready }: { run: Run; events: RunEvent[]; ready: boolean }) {
  const { scroller, content, onScroll, onWheel } = useStickToBottom();
  const live = run.status === 'running';
  return (
    <div ref={scroller} onScroll={onScroll} onWheel={onWheel} className="grid-bg h-full overflow-y-auto px-5 py-4">
      <div ref={content}>
        {!ready && <Spinner />}
        {ready && events.length === 0 && (
          <p className="text-xs text-zinc-500">{run.status === 'queued' ? 'Queued — waiting for a free agent slot.' : 'No activity recorded.'}</p>
        )}
        <EventList events={events} live={live} />
        {live && (
          <div className="mt-3 flex items-center gap-2 pl-1 text-2xs text-cyan-300/80">
            <LiveDot /> working…
          </div>
        )}
      </div>
    </div>
  );
}

function EventRow({ e }: { e: RunEvent }) {
  const text = typeof e.data.text === 'string' ? e.data.text : '';
  switch (e.type) {
    case 'init':
      return (
        <div className="flex items-center gap-2 py-1 text-2xs text-zinc-500">
          <Sparkles className="h-3 w-3 text-violet-300" />
          Fresh session · {String(e.data.model ?? '')} · {Array.isArray(e.data.tools) ? `${e.data.tools.length} tools` : ''}
        </div>
      );
    case 'text':
      return (
        <div className="rounded-xl border border-line bg-surface/90 px-3.5 py-2.5">
          <Markdown tight>{text}</Markdown>
        </div>
      );
    case 'thinking':
      return <Collapsible label="Thinking" className="italic text-zinc-500">{text}</Collapsible>;
    case 'result': {
      const d = e.data as { isError?: boolean; costUsd?: number; numTurns?: number; durationMs?: number; text?: string };
      return (
        <div className={cn('mt-2 rounded-xl border px-3.5 py-2.5', d.isError ? 'border-rose-500/30 bg-rose-500/[0.06]' : 'border-emerald-400/25 bg-emerald-400/[0.05]')}>
          <div className="flex flex-wrap items-center gap-3 text-2xs text-zinc-400">
            <span className={cn('font-semibold', d.isError ? 'text-rose-300' : 'text-emerald-300')}>{d.isError ? 'Ended with an error' : 'Finished'}</span>
            <span>{money(d.costUsd)}</span>
            <span>{d.numTurns} turns</span>
            <span>{d.durationMs ? `${Math.round(d.durationMs / 1000)}s` : ''}</span>
          </div>
          {d.text && <p className="mt-1.5 font-mono text-xs text-zinc-300">{d.text}</p>}
        </div>
      );
    }
    case 'stderr':
      return <pre className="whitespace-pre-wrap font-mono text-2xs text-rose-300/80">{text}</pre>;
    default:
      return (
        <div className="flex items-start gap-2 py-0.5 font-mono text-2xs text-zinc-500">
          <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-zinc-600" />
          <span className="whitespace-pre-wrap break-all">{text}</span>
        </div>
      );
  }
}

function LogBlock({ lines }: { lines: RunEvent[] }) {
  const text = lines.map((l) => String(l.data.text ?? '')).join('');
  return <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-black/60 p-3 font-mono text-[11.5px] leading-relaxed text-zinc-300">{text}</pre>;
}

function ToolRow({ use, result, pending }: { use: RunEvent; result?: RunEvent; pending: boolean }) {
  const [open, setOpen] = useState(false);
  const name = String(use.data.name ?? 'tool');
  const input = (use.data.input ?? {}) as Record<string, unknown>;
  const Icon = TOOL_ICONS[name] ?? Wrench;
  const isError = !!result?.data.isError;
  return (
    <div className={cn('rounded-lg border bg-surface/70 transition-colors', isError ? 'border-rose-500/25' : 'border-line', open && 'bg-surface')}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left">
        <ChevronRight className={cn('h-3 w-3 shrink-0 text-zinc-600 transition-transform', open && 'rotate-90')} />
        <Icon className={cn('h-3.5 w-3.5 shrink-0', isError ? 'text-rose-400' : 'text-zinc-400')} />
        <span className="shrink-0 text-xs font-medium text-zinc-200">{name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-zinc-500">{toolSummary(name, input)}</span>
        {pending && <Spinner className="h-3 w-3 text-cyan-400" />}
        {isError && <span className="text-2xs text-rose-300">error</span>}
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-3 py-2.5">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-black/50 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-400">
            {name === 'Bash' ? String(input.command ?? '') : JSON.stringify(input, null, 2)}
          </pre>
          {result && (
            <pre className={cn('max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-black/50 p-2.5 font-mono text-[11px] leading-relaxed', isError ? 'text-rose-300' : 'text-zinc-300')}>
              {String(result.data.text ?? '') || '(no output)'}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Collapsible({ label, children, className }: { label: string; children: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-1">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-2xs text-zinc-600 hover:text-zinc-400">
        <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} /> {label}
      </button>
      {open && <p className={cn('mt-1 whitespace-pre-wrap pl-4 text-xs leading-relaxed', className)}>{children}</p>}
    </div>
  );
}
