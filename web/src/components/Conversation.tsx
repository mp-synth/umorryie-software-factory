import { toastError } from '@/lib/toasts';
import { useMutation } from '@tanstack/react-query';
import { Bot, Info, MessageCircleQuestion, MessagesSquare, Send, StickyNote, User } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { InitiativeDetail, Message, RunKind } from '@factory/shared';
import { api } from '@/lib/api';
import { isRunInFlight } from '@/lib/status';
import { ago, cn, pad2 } from '@/lib/utils';
import { Markdown } from './Markdown';
import { useRunDock } from './RunDock';
import { Button, Card, CardHeader, Segmented, Select, Spinner, Textarea } from './ui';

type Mode = 'question' | 'feedback' | 'comment';

const WORKING: Partial<Record<RunKind, string>> = {
  ask: 'Advisor is reading the code…',
  steer: 'Routing your feedback to the PRs it belongs to…',
  retro: 'Retro is looking at what you had to steer…',
};

export function Conversation({ detail }: { detail: InitiativeDetail }) {
  const { initiative: i, messages, tickets, runs } = detail;
  const dock = useRunDock();
  const [target, setTarget] = useState<string>('initiative');
  const [mode, setMode] = useState<Mode>('question');
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<'all' | 'talk'>('all');
  const scroller = useRef<HTMLDivElement>(null);
  const planLocked = ['in_progress', 'done'].includes(i.status);
  const ticketTarget = target !== 'initiative' ? tickets.find((t) => t.id === target) : null;
  const steering = !ticketTarget && planLocked;
  const feedbackDisabled = !!ticketTarget && ['merged', 'canceled'].includes(ticketTarget.status);

  useEffect(() => {
    if (feedbackDisabled && mode === 'feedback') setMode('question');
  }, [feedbackDisabled, mode]);

  const pendingAsks = runs.filter((r) => WORKING[r.kind] && isRunInFlight(r));
  const shown = useMemo(() => (filter === 'talk' ? messages.filter((m) => m.kind !== 'event') : messages), [messages, filter]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, pendingAsks.length]);

  const send = useMutation({
    mutationFn: () => api.message(i.id, { body: text, kind: mode, ticketId: ticketTarget?.id ?? null, act: true }),
    onSuccess: () => {
      setText('');
      if (mode === 'feedback') {
        toast.success(ticketTarget ? 'Feedback sent to a fresh fixer' : steering ? 'Feedback sent — a fresh agent routes it to the PRs it belongs to' : 'Feedback sent — a fresh planner is revising');
      }
    },
    onError: toastError,
  });

  const placeholder =
    mode === 'question'
      ? 'Ask about the plan, a ticket or the code. A read-only agent answers with file references.'
      : mode === 'feedback'
        ? ticketTarget
          ? `What should change in ${pad2(ticketTarget.seq)}? A fresh fixer applies it.`
          : steering
            ? 'What should change across the PRs? A fresh agent finds the PRs it belongs to and sends each to a fresh fixer.'
            : 'What should the planner change? Be specific: what is good, what to change, what not to touch.'
        : 'A note for the record. No agent is started.';

  return (
    <Card className="flex max-h-[calc(100vh-120px)] flex-col">
      <CardHeader
        icon={<MessagesSquare className="h-3.5 w-3.5" />}
        title="Activity"
        sub="Talk to the agents. Every reply comes from a fresh context."
        right={<Segmented size="xs" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'talk', label: 'Conversation' }]} />}
      />
      <div ref={scroller} className="min-h-[200px] flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {shown.length === 0 && <p className="py-8 text-center text-xs text-zinc-600">Nothing here yet.</p>}
        {shown.map((m) => (
          <MessageItem key={m.id} m={m} ticket={m.ticketId ? tickets.find((t) => t.id === m.ticketId) : undefined} onOpenRun={m.runId ? () => dock.watch(m.runId!) : undefined} />
        ))}
        {pendingAsks.map((r) => (
          <button key={r.id} onClick={() => dock.watch(r.id)} className="flex items-center gap-2 rounded-lg border border-fuchsia-400/20 bg-fuchsia-400/[0.05] px-3 py-2 text-xs text-fuchsia-200">
            <Spinner className="text-fuchsia-300" /> {WORKING[r.kind]}
          </button>
        ))}
      </div>
      <div className="border-t border-line p-3">
        <div className="mb-2 flex items-center gap-2">
          <Segmented
            size="xs"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'question', label: <><MessageCircleQuestion className="h-3 w-3" /> Ask</> },
              ...(!feedbackDisabled ? [{ value: 'feedback' as Mode, label: <><Send className="h-3 w-3" /> Feedback</> }] : []),
              { value: 'comment', label: <><StickyNote className="h-3 w-3" /> Note</> },
            ]}
          />
          <div className="ml-auto w-[150px]">
            <Select value={target} onChange={(e) => setTarget(e.target.value)} className="h-7 text-2xs">
              <option value="initiative">Whole initiative</option>
              {tickets.map((t) => (
                <option key={t.id} value={t.id}>
                  {pad2(t.seq)} · {t.title}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) send.mutate();
          }}
          placeholder={placeholder}
          className="min-h-[72px] text-xs"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-2xs text-zinc-600">⌘↵ to send</span>
          <Button size="sm" variant="primary" disabled={!text.trim()} loading={send.isPending} onClick={() => send.mutate()} icon={<Send className="h-3 w-3" />}>
            {mode === 'question' ? 'Ask' : mode === 'feedback' ? (ticketTarget ? 'Send to fixer' : steering ? 'Send to the PRs' : 'Send & re-plan') : 'Add note'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function MessageItem({ m, ticket, onOpenRun }: { m: Message; ticket?: { seq: number; title: string }; onOpenRun?: () => void }) {
  if (m.kind === 'event' || m.author === 'system') {
    return (
      <div className="flex gap-2 text-2xs leading-relaxed text-zinc-500">
        <Info className="mt-0.5 h-3 w-3 shrink-0 text-zinc-600" />
        <div className="min-w-0 flex-1">
          <Markdown tight className="prose-p:text-zinc-500 [&_*]:text-[11.5px]">{m.body}</Markdown>
        </div>
        <span className="shrink-0 text-zinc-700">{ago(m.createdAt)}</span>
      </div>
    );
  }
  const human = m.author === 'human';
  const kindLabel: Record<string, string> = { feedback: 'feedback', question: 'question', answer: 'answer', approval: 'approval', comment: '' };
  return (
    <div className={cn('flex gap-2.5', human && 'flex-row-reverse')}>
      <span
        className={cn(
          'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border',
          human ? 'border-violet-400/30 bg-violet-500/15 text-violet-200' : 'border-line-strong bg-surface-3 text-zinc-300',
        )}
      >
        {human ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
      </span>
      <div className={cn('min-w-0 max-w-[88%]', human && 'text-right')}>
        <div className={cn('mb-1 flex items-center gap-1.5 text-2xs text-zinc-500', human && 'justify-end')}>
          <span className="font-medium text-zinc-400">{human ? 'You' : 'Agent'}</span>
          {kindLabel[m.kind] && <span>· {kindLabel[m.kind]}</span>}
          {ticket && <span className="font-mono">· {pad2(ticket.seq)}</span>}
          <span>· {ago(m.createdAt)}</span>
          {onOpenRun && !human && (
            <button onClick={onOpenRun} className="text-violet-300/80 hover:text-violet-200">
              · run
            </button>
          )}
        </div>
        <div
          className={cn(
            'inline-block rounded-2xl px-3 py-2 text-left',
            human ? 'rounded-tr-sm bg-violet-500/15 ring-1 ring-violet-400/20' : 'rounded-tl-sm bg-surface-2 ring-1 ring-line',
            m.kind === 'approval' && 'bg-emerald-500/10 ring-emerald-400/25',
          )}
        >
          <Markdown tight className="[&_*]:text-[12.5px]">{m.body}</Markdown>
        </div>
      </div>
    </div>
  );
}
