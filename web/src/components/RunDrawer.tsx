import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronRight,
  Copy,
  FilePlus2,
  FileText,
  FolderSearch,
  Globe,
  PencilLine,
  Search,
  Sparkles,
  Square,
  Terminal,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { Run, RunEvent } from '@factory/shared';
import { api } from '@/lib/api';
import { useNow, useRunEvents } from '@/lib/live';
import { runKind } from '@/lib/status';
import { cn, copy, money, pad2, runDuration, shortPath, tokens } from '@/lib/utils';
import { Markdown } from './Markdown';
import { RunPill, VerdictPill } from './StatusPill';
import { Button, Chip, Segmented, Spinner } from './ui';

export function useRunDrawer() {
  const [params, setParams] = useSearchParams();
  return {
    runId: params.get('run'),
    open: (id: string) => {
      const next = new URLSearchParams(params);
      next.set('run', id);
      setParams(next);
    },
    close: () => {
      const next = new URLSearchParams(params);
      next.delete('run');
      setParams(next);
    },
  };
}

export function RunDrawer() {
  const { runId, close } = useRunDrawer();
  return (
    <DialogPrimitive.Root open={!!runId} onOpenChange={(v) => !v && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[820px] flex-col border-l border-line-strong bg-[#0d0d11] shadow-2xl data-[state=open]:animate-slide-in"
        >
          {runId && <RunView runId={runId} onClose={close} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function RunView({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { data: run } = useQuery({ queryKey: ['run', runId], queryFn: () => api.run(runId), refetchInterval: (q) => (q.state.data?.status === 'running' ? 5000 : false) });
  const { events, ready } = useRunEvents(runId);
  const live = run?.status === 'running' || run?.status === 'queued';
  const now = useNow(1000, live);
  const [tab, setTab] = useState<'activity' | 'output' | 'prompt'>('activity');
  const cancel = useMutation({
    mutationFn: () => api.cancelRun(runId),
    onSuccess: () => toast.success('Cancel requested'),
    onError: (e: Error) => toast.error(e.message),
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

  return (
    <>
      <div className="border-b border-line px-5 pb-3 pt-4">
        <div className="flex items-start gap-3">
          <div className={cn('mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-surface-2', k.color)}>
            <Icon className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-zinc-100">
              {k.agent}
              <span className="font-normal text-zinc-500">·</span>
              <span className="truncate font-normal text-zinc-300">
                {run.ticketSeq ? `[${pad2(run.ticketSeq)}] ${run.ticketTitle}` : run.initiativeTitle}
              </span>
            </DialogPrimitive.Title>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <RunPill status={run.status} />
              <VerdictPill verdict={run.verdict} />
              {run.model && <Chip>{run.model}{run.effort ? ` · ${run.effort}` : ''}</Chip>}
              {run.round > 0 && <Chip>round {run.round}</Chip>}
              <Chip>{run.trigger === 'auto' ? 'autopilot' : 'manual'}</Chip>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {live && (
              <Button size="sm" variant="danger" icon={<Square className="h-3 w-3" />} loading={cancel.isPending} onClick={() => cancel.mutate()}>
                Stop
              </Button>
            )}
            <DialogPrimitive.Close className="rounded-md p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-200" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
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
              { value: 'activity', label: <>Activity {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />}</> },
              { value: 'output', label: 'Output' },
              { value: 'prompt', label: 'Prompt' },
            ]}
          />
          {resume && (
            <Button size="xs" variant="ghost" icon={<Terminal className="h-3 w-3" />} onClick={() => copy(resume).then(() => toast.success('Resume command copied'))}>
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
      <div className="text-[10px] uppercase tracking-wider text-zinc-600">{label}</div>
      <div className="mt-0.5 font-mono text-xs text-zinc-200">{value}</div>
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
                <button className="text-zinc-600 hover:text-zinc-300" onClick={() => copy(v).then(() => toast.success('Copied'))} aria-label={`Copy ${k}`}>
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

// ---------------------------------------------------------------- activity stream

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

function Activity({ run, events, ready }: { run: Run; events: RunEvent[]; ready: boolean }) {
  const items = useMemo(() => buildItems(events), [events]);
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items]);
  const live = run.status === 'running';
  return (
    <div
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="grid-bg h-full overflow-y-auto px-5 py-4"
    >
      {!ready && <Spinner />}
      {ready && items.length === 0 && (
        <p className="text-xs text-zinc-500">{run.status === 'queued' ? 'Queued — waiting for a free agent slot.' : 'No activity recorded.'}</p>
      )}
      <ol className="space-y-1.5">
        {items.map((item, i) => (
          <li key={item.type === 'tool' ? item.use.id : item.type === 'logs' ? item.lines[0].id : item.e.id} className="animate-fade-in">
            {item.type === 'tool' ? <ToolRow use={item.use} result={item.result} pending={live && !item.result && i === items.length - 1} /> : item.type === 'logs' ? <LogBlock lines={item.lines} /> : <EventRow e={item.e} />}
          </li>
        ))}
      </ol>
      {live && (
        <div className="mt-3 flex items-center gap-2 pl-1 text-2xs text-cyan-300/80">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" /> working…
        </div>
      )}
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
