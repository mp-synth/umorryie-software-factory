import type { RunEvent } from '@factory/shared';
import { ChevronRight, FilePlus2, FileText, FolderSearch, Globe, ListTree, PencilLine, Search, Sparkles, Terminal, Wrench, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Markdown } from '@/components/Markdown';
import { Spinner } from '@/components/ui';
import type { ActivityDetail } from '@/lib/preferences';
import { cn, money } from '@/lib/utils';
import { buildItems, describeSteps, toolSummary } from './events';

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

export function EventList({ events, live, detail }: { events: RunEvent[]; live: boolean; detail: ActivityDetail }) {
  const items = useMemo(() => buildItems(events, detail), [events, detail]);
  return (
    <ol className="space-y-1.5">
      {items.map((item, i) => {
        const key = item.type === 'tool' ? item.use.id : item.type === 'logs' ? item.lines[0].id : item.type === 'steps' ? `steps-${item.id}` : item.e.id;
        const pending = live && i === items.length - 1;
        return (
          <li key={key} className="animate-fade-in">
            {item.type === 'tool' ? (
              <ToolRow use={item.use} result={item.result} pending={pending && !item.result} defaultOpen={detail === 'verbose'} />
            ) : item.type === 'logs' ? (
              <LogBlock lines={item.lines} />
            ) : item.type === 'steps' ? (
              <StepsRow tools={item.tools} pending={pending} />
            ) : (
              <EventRow e={item.e} verbose={detail === 'verbose'} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StepsRow({ tools, pending }: { tools: string[]; pending: boolean }) {
  return (
    <div className="flex items-center gap-2 px-1 py-0.5 text-xs text-ink-tertiary">
      <ListTree className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{describeSteps(tools)}</span>
      {pending && <Spinner className="size-3 text-ink-alert" />}
    </div>
  );
}

function EventRow({ e, verbose }: { e: RunEvent; verbose: boolean }) {
  const text = typeof e.data.text === 'string' ? e.data.text : '';
  switch (e.type) {
    case 'init':
      return (
        <div className="flex items-center gap-2 px-1 py-1 text-xs text-ink-tertiary">
          <Sparkles className="size-3.5 text-ink-accent" />
          Fresh session · {String(e.data.model ?? '')}
          {Array.isArray(e.data.tools) ? ` · ${e.data.tools.length} tools` : ''}
        </div>
      );
    case 'text':
      return (
        <div className="rounded-lg border border-line-subtle bg-panel px-3.5 py-2.5 shadow-xs">
          <Markdown tight>{text}</Markdown>
        </div>
      );
    case 'thinking':
      return (
        <Fold label="Thinking" defaultOpen={verbose}>
          <p className="whitespace-pre-wrap text-sm italic leading-relaxed text-ink-secondary">{text}</p>
        </Fold>
      );
    case 'result': {
      const d = e.data as { isError?: boolean; costUsd?: number; numTurns?: number; durationMs?: number; text?: string };
      return (
        <div className={cn('mt-2 rounded-lg border px-3.5 py-2.5', d.isError ? 'border-tone-bad-line bg-tone-bad-fill dark:bg-tone-bad-fill/40' : 'border-tone-good-line bg-tone-good-fill dark:bg-tone-good-fill/40')}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-secondary">
            <span className={cn('font-medium', d.isError ? 'text-ink-bad' : 'text-ink-good')}>{d.isError ? 'Ended with an error' : 'Finished'}</span>
            <span className="numeric">{money(d.costUsd)}</span>
            {d.numTurns != null && <span className="numeric">{d.numTurns} turns</span>}
            {d.durationMs ? <span className="numeric">{Math.round(d.durationMs / 1000)}s</span> : null}
          </div>
          {d.text && <p className="mt-1.5 font-mono text-xs text-ink">{d.text}</p>}
        </div>
      );
    }
    case 'stderr':
      return <pre className="whitespace-pre-wrap px-1 font-mono text-xs text-ink-bad">{text}</pre>;
    default:
      return (
        <div className="flex items-start gap-2 px-1 py-0.5 font-mono text-xs text-ink-tertiary">
          <ChevronRight className="mt-0.5 size-3 shrink-0" />
          <span className="whitespace-pre-wrap break-all">{text}</span>
        </div>
      );
  }
}

function LogBlock({ lines }: { lines: RunEvent[] }) {
  const text = lines.map((l) => String(l.data.text ?? '')).join('');
  return <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg border border-line-subtle bg-sunken p-3 font-mono text-xs leading-relaxed text-ink-secondary">{text}</pre>;
}

function ToolRow({ use, result, pending, defaultOpen }: { use: RunEvent; result?: RunEvent; pending: boolean; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const name = String(use.data.name ?? 'tool');
  const input = (use.data.input ?? {}) as Record<string, unknown>;
  const Icon = TOOL_ICONS[name] ?? Wrench;
  const isError = !!result?.data.isError;
  return (
    <div className={cn('rounded-lg border bg-panel transition-colors', isError ? 'border-tone-bad-line' : 'border-line-subtle')}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left hover:bg-hover">
        <ChevronRight className={cn('size-3 shrink-0 text-ink-tertiary transition-transform', open && 'rotate-90')} />
        <Icon className={cn('size-3.5 shrink-0', isError ? 'text-ink-bad' : 'text-ink-secondary')} />
        <span className="shrink-0 text-sm font-medium text-ink">{name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-tertiary">{toolSummary(name, input)}</span>
        {pending && <Spinner className="size-3 text-ink-alert" />}
        {isError && <span className="text-xs font-medium text-ink-bad">error</span>}
      </button>
      {open && (
        <div className="space-y-2 border-t border-line-subtle px-3 py-2.5">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-sunken p-2.5 font-mono text-xs leading-relaxed text-ink-secondary">
            {name === 'Bash' ? String(input.command ?? '') : JSON.stringify(input, null, 2)}
          </pre>
          {result && (
            <pre className={cn('max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-sunken p-2.5 font-mono text-xs leading-relaxed', isError ? 'text-ink-bad' : 'text-ink')}>
              {String(result.data.text ?? '') || '(no output)'}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Fold({ label, children, defaultOpen }: { label: string; children: React.ReactNode; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="px-1">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-1.5 text-xs text-ink-tertiary hover:text-ink-secondary">
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} /> {label}
      </button>
      {open && <div className="mt-1 pl-4">{children}</div>}
    </div>
  );
}
