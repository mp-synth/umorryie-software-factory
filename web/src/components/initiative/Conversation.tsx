import { useMutation } from '@tanstack/react-query';
import { Bot, Info, MessageCircleQuestion, MessagesSquare, Send, StickyNote, User } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { InitiativeDetail, Message, RunKind } from '@factory/shared';
import { useRunDock } from '@/components/dock/use-run-dock';
import { Markdown } from '@/components/Markdown';
import { Button, Card, CardHeader, EmptyState, Segmented, Select, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { MOD } from '@/lib/shortcuts';
import { isRunInFlight } from '@/lib/status';
import { toastError } from '@/lib/toasts';
import { ago, cn, pad2 } from '@/lib/utils';

type Mode = 'question' | 'feedback' | 'comment';

const WORKING: Partial<Record<RunKind, string>> = {
  ask: 'The advisor is reading the code to answer…',
  steer: 'Routing your feedback to the pull requests it belongs to…',
  retro: 'The retro is looking at what you had to steer…',
};

const KIND_LABELS: Record<string, string> = { feedback: 'Feedback', question: 'Question', answer: 'Answer', approval: 'Approval', comment: 'Note' };

export function Conversation({ detail }: { detail: InitiativeDetail }) {
  const { initiative: i, messages, tickets, runs } = detail;
  const dock = useRunDock();
  const [target, setTarget] = useState<string>('initiative');
  const [mode, setMode] = useState<Mode>('question');
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<'all' | 'talk'>('all');
  const scroller = useRef<HTMLDivElement>(null);
  const planLocked = ['in_progress', 'done'].includes(i.status);
  const ticket = target !== 'initiative' ? tickets.find((t) => t.id === target) : null;
  const steering = !ticket && planLocked;
  const feedbackDisabled = !!ticket && ['merged', 'canceled'].includes(ticket.status);

  useEffect(() => {
    if (feedbackDisabled && mode === 'feedback') setMode('question');
  }, [feedbackDisabled, mode]);

  const pending = runs.filter((r) => WORKING[r.kind] && isRunInFlight(r));
  const shown = useMemo(() => (filter === 'talk' ? messages.filter((m) => m.kind !== 'event' && m.author !== 'system') : messages), [messages, filter]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, pending.length]);

  const send = useMutation({
    mutationFn: () => api.message(i.id, { body: text, kind: mode, ticketId: ticket?.id ?? null, act: true }),
    onSuccess: () => {
      setText('');
      if (mode === 'feedback') toast.success(ticket ? 'Feedback sent to a fresh fixer' : steering ? 'Feedback sent. A fresh agent routes it to the PRs it belongs to.' : 'Feedback sent. A fresh planner is revising.');
    },
    onError: toastError,
  });

  const outcome =
    mode === 'question'
      ? 'A read-only advisor answers here, with references to the files it read.'
      : mode === 'comment'
        ? 'Saved here for the record. No agent starts.'
        : ticket
          ? `A fresh ${ticket.branch ? 'fixer' : 'executor'} applies it to ticket ${pad2(ticket.seq)}${ticket.branch ? ' on its branch' : ''}.`
          : steering
            ? 'A fresh agent finds the pull requests it belongs to, and sends each one a fresh fixer.'
            : 'A fresh planner revises the plan with it. Be specific: what is good, what to change, what not to touch.';
  const placeholder = mode === 'question' ? 'Ask about the plan, a ticket or the code…' : mode === 'feedback' ? 'What should change?' : 'Write a note…';
  const ready = !!text.trim() && !send.isPending;

  return (
    <Card className="flex max-h-[calc(100vh-12rem)] min-h-[28rem] flex-col">
      <CardHeader
        icon={<MessagesSquare />}
        title="Conversation"
        description="Talk to the agents. Every answer comes from a fresh context."
        actions={<Segmented size="xs" label="Show" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'Everything' }, { value: 'talk', label: 'Messages only' }]} />}
      />
      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {shown.length === 0 && (
          <EmptyState icon={<MessagesSquare />} title="Nothing here yet" className="py-8">
            Ask a question about the plan or the code, or send feedback. What agents decide and do on their own shows up here too.
          </EmptyState>
        )}
        {shown.map((m) => (
          <MessageItem key={m.id} m={m} ticket={m.ticketId ? tickets.find((t) => t.id === m.ticketId) : undefined} onOpenRun={m.runId ? () => dock.watch(m.runId!) : undefined} />
        ))}
        {pending.map((r) => (
          <button key={r.id} type="button" onClick={() => dock.watch(r.id)} className="flex w-full items-center gap-2 rounded-lg border border-tone-active-line bg-tone-active-fill dark:bg-tone-active-fill/40 px-3 py-2 text-left text-sm text-ink">
            <Spinner className="text-ink-alert" /> {WORKING[r.kind]}
            <span className="ml-auto text-xs text-ink-secondary">Watch</span>
          </button>
        ))}
      </div>
      <div className="border-t border-line-subtle p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Segmented
            size="xs"
            label="Message type"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'question', label: <><MessageCircleQuestion /> Ask</> },
              ...(!feedbackDisabled ? [{ value: 'feedback' as Mode, label: <><Send /> Feedback</> }] : []),
              { value: 'comment', label: <><StickyNote /> Note</> },
            ]}
          />
          <div className="ml-auto w-56 max-w-full">
            <Select size="sm" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="About">
              <option value="initiative">About the whole initiative</option>
              {tickets.map((t) => (
                <option key={t.id} value={t.id}>
                  {pad2(t.seq)} · {t.title}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="rounded-lg border border-line bg-panel transition-[border-color,box-shadow] focus-within:border-line-focus focus-within:shadow-[0_0_0_3px_var(--fill-accent-subtle)]">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ready && send.mutate()}
            placeholder={placeholder}
            aria-label="Message"
            className="min-h-[4.5rem] w-full resize-y bg-transparent px-3 py-2 text-sm text-ink placeholder:text-ink-tertiary focus:outline-none"
          />
          <div className="flex items-center gap-3 px-2 pb-2">
            <p className="min-w-0 flex-1 text-pretty px-1 text-xs text-ink-secondary">{outcome}</p>
            <span className="hidden shrink-0 text-xs text-ink-tertiary @md:inline">{MOD}↵</span>
            <Button size="sm" variant="primary" disabled={!ready} loading={send.isPending} onClick={() => send.mutate()} icon={<Send />}>
              {mode === 'question' ? 'Ask' : mode === 'feedback' ? (ticket ? 'Send to a fixer' : steering ? 'Send to the PRs' : 'Send and re-plan') : 'Add note'}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function MessageItem({ m, ticket, onOpenRun }: { m: Message; ticket?: { seq: number; title: string }; onOpenRun?: () => void }) {
  if (m.kind === 'event' || m.author === 'system') {
    return (
      <div className="flex gap-2 px-1 text-xs leading-relaxed text-ink-tertiary">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <Markdown tight className="text-xs [--tw-prose-body:var(--ink-tertiary)]">
            {m.body}
          </Markdown>
        </div>
        <span className="shrink-0">{ago(m.createdAt)}</span>
      </div>
    );
  }
  const human = m.author === 'human';
  return (
    <div className={cn('flex gap-2.5', human && 'flex-row-reverse')}>
      <span className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-full', human ? 'bg-primary text-ink-on-primary' : 'bg-neutral-subtle text-ink-secondary')}>
        {human ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </span>
      <div className={cn('min-w-0 max-w-[85%]', human && 'text-right')}>
        <div className={cn('mb-1 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-tertiary', human && 'justify-end')}>
          <span className="font-medium text-ink-secondary">{human ? 'You' : 'Agent'}</span>
          {KIND_LABELS[m.kind] && m.kind !== 'comment' && <span>· {KIND_LABELS[m.kind].toLowerCase()}</span>}
          {ticket && <span className="numeric">· {pad2(ticket.seq)}</span>}
          <span>· {ago(m.createdAt)}</span>
          {onOpenRun && !human && (
            <button type="button" onClick={onOpenRun} className="font-medium text-ink-accent hover:underline">
              · open the run
            </button>
          )}
        </div>
        <div
          className={cn(
            'inline-block rounded-2xl px-3.5 py-2 text-left',
            human ? 'rounded-tr-sm bg-tone-accent-fill dark:bg-tone-accent-fill/40' : 'rounded-tl-sm border border-line-subtle bg-panel',
            m.kind === 'approval' && 'border-tone-good-line bg-tone-good-fill dark:bg-tone-good-fill/40',
          )}
        >
          <Markdown tight>{m.body}</Markdown>
        </div>
      </div>
    </div>
  );
}
