import { useMutation } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  BrainCircuit,
  ClipboardCopy,
  FileText,
  FolderGit2,
  Gauge,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GraduationCap,
  ListChecks,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { InitiativeDetail } from '@factory/shared';
import { AutopilotPanel } from '@/components/initiative/AutopilotPanel';
import { Conversation } from '@/components/initiative/Conversation';
import { PlanPanel } from '@/components/initiative/PlanPanel';
import { StatusCard } from '@/components/initiative/StatusCard';
import { defaultTab, tabsFor, type InitiativeTab } from '@/components/initiative/tabs';
import { TicketList } from '@/components/initiative/TicketList';
import { Markdown } from '@/components/Markdown';
import { RulesPanel } from '@/components/RulesPanel';
import { usePageMeta } from '@/components/shell/page-meta';
import { InitiativeBadge } from '@/components/StatusBadge';
import {
  Button,
  ButtonLink,
  Card,
  Chip,
  Dialog,
  EmptyState,
  Field,
  Input,
  Menu,
  MenuItem,
  MenuSeparator,
  Page,
  PageHeader,
  Skeleton,
  Tabs,
  Textarea,
  confirmAction,
  type TabItem,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useInitiative } from '@/lib/queries';
import { TICKET_FILTERS, ticketFilterOf, type TicketFilter } from '@/lib/tickets';
import { toastError, toastSuccess } from '@/lib/toasts';
import { ago, copy, money, shortPath } from '@/lib/utils';

export function InitiativePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading, refetch } = useInitiative(id);
  usePageMeta(data?.initiative.title ?? (isLoading ? 'Loading…' : 'Initiative'), [{ label: 'Overview', to: '/' }]);

  if (isLoading) {
    return (
      <Page width="wide">
        <div className="space-y-4">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </Page>
    );
  }
  if (error || !data) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <Page width="narrow">
        <EmptyState
          title={missing ? 'This initiative no longer exists' : 'Could not load the initiative'}
          actions={
            <>
              {!missing && (
                <Button variant="primary" onClick={() => refetch()}>
                  Try again
                </Button>
              )}
              <ButtonLink to="/" variant="outline">
                Go to the overview
              </ButtonLink>
            </>
          }
        >
          {missing ? 'It may have been deleted.' : (error as Error | null)?.message}
        </EmptyState>
      </Page>
    );
  }
  return <Initiative detail={data} />;
}

function Initiative({ detail }: { detail: InitiativeDetail }) {
  const { initiative: i, project, tickets, runs } = detail;
  const [params, setParams] = useSearchParams();
  const tabs = tabsFor(detail);
  const tab = (tabs as string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as InitiativeTab) : defaultTab(detail);
  const show = TICKET_FILTERS.some((f) => f.value === params.get('show')) ? (params.get('show') as TicketFilter) : 'all';
  const go = (next: { tab?: InitiativeTab; show?: string | null }) => {
    const p = new URLSearchParams(params);
    if (next.tab) p.set('tab', next.tab);
    if (next.show === null || (next.show === undefined && next.tab)) p.delete('show');
    else if (next.show) p.set('show', next.show);
    setParams(p, { replace: true });
  };

  const live = tickets.filter((t) => t.status !== 'canceled');
  const needsYou = tickets.filter((t) => ticketFilterOf(t, runs.filter((r) => r.ticketId === t.id)) === 'needs-you').length;
  const proposedRules = (detail.rules ?? []).filter((r) => r.status === 'proposed').length;
  const planWaits = ['awaiting_approval', 'needs_input'].includes(i.status);
  const items: Record<InitiativeTab, TabItem<InitiativeTab>> = {
    plan: { value: 'plan', label: 'Plan', icon: <BrainCircuit />, dot: planWaits ? 'warn' : undefined },
    tickets: { value: 'tickets', label: 'Tickets', icon: <ListChecks />, count: live.length, countTone: needsYou ? 'bad' : 'neutral' },
    conversation: { value: 'conversation', label: 'Conversation', icon: <MessagesSquare /> },
    rules: { value: 'rules', label: 'Learned rules', icon: <GraduationCap />, count: proposedRules, countTone: 'warn' },
    autopilot: { value: 'autopilot', label: 'Autopilot', icon: <Gauge /> },
  };

  return (
    <Page width="wide">
      <Header detail={detail} onAutopilot={() => go({ tab: 'autopilot' })} />
      <StatusCard detail={detail} onTab={(t, s) => go({ tab: t, show: s ?? null })} />
      <Tabs label="Initiative sections" className="mt-6" value={tab} onChange={(t) => go({ tab: t })} items={tabs.map((t) => items[t])} />
      <div className="mt-5" role="tabpanel">
        {tab === 'plan' && <PlanPanel detail={detail} />}
        {tab === 'tickets' && <TicketList detail={detail} show={show} onShow={(f) => go({ show: f === 'all' ? null : f })} />}
        {tab === 'conversation' && <Conversation detail={detail} />}
        {tab === 'rules' && <RulesPanel detail={detail} />}
        {tab === 'autopilot' && <AutopilotPanel detail={detail} />}
      </div>
      <p className="mt-8 text-pretty text-xs leading-relaxed text-ink-tertiary">
        Agents never touch <span className="font-mono">{shortPath(project.repoPath)}</span> directly: each ticket gets its own worktree and <span className="font-mono">factory/*</span> branch, and every
        step is a fresh <span className="font-mono">claude -p</span> process.
      </p>
    </Page>
  );
}

function Header({ detail, onAutopilot }: { detail: InitiativeDetail; onAutopilot: () => void }) {
  const { initiative: i, project } = detail;
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  const isFeature = i.kind !== 'open-prs';
  const hasOpenPrs = detail.tickets.some((t) => t.prNumber && t.prState !== 'MERGED' && t.prState !== 'CLOSED');
  // Open PRs not known to be ready: drafts, and ones the PR sync has not looked at yet (the server asks GitHub before each).
  const drafts = detail.tickets.filter((t) => t.prNumber && t.prState === 'OPEN' && t.prDraft !== false && t.status !== 'merged' && t.status !== 'canceled').sort((a, b) => a.seq - b.seq);

  const update = useMutation({ mutationFn: (p: { status: 'archived' | 'draft' }) => api.updateInitiative(i.id, p), onSuccess: (_r, p) => toast.success(p.status === 'archived' ? 'Archived' : 'Restored'), onError: toastError });
  const reset = useMutation({ mutationFn: () => api.resetInitiative(i.id), onSuccess: toastSuccess('Reset to draft'), onError: toastError });
  const report = useMutation({ mutationFn: () => api.reportMarkdown(i.id).then(copy), onSuccess: toastSuccess('Report copied as Markdown'), onError: toastError });
  const fixPrs = useMutation({
    mutationFn: () => api.bulk(i.id, 'fix-prs'),
    onSuccess: ({ count }) => toast.success(count ? `Started a fixer on ${count} PR${count > 1 ? 's' : ''}` : 'No open PR has anything to fix right now'),
    onError: toastError,
  });
  const retro = useMutation({ mutationFn: () => api.retro(i.id), onSuccess: toastSuccess('Retro queued: it proposes rules under Learned rules'), onError: toastError });
  const markReady = useMutation({
    mutationFn: () => api.bulk(i.id, 'ready-prs'),
    onSuccess: ({ count }) => toast.success(count ? `Marked ${count} PR${count > 1 ? 's' : ''} ready for review` : 'No draft PR left: they are all ready for review'),
    onError: toastError,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteInitiative(i.id),
    onSuccess: () => {
      toast.success('Initiative deleted');
      navigate('/');
    },
    onError: toastError,
  });

  const askReset = async () => {
    const ok = await confirmAction({
      title: 'Reset to draft?',
      description: 'This stops every agent and deletes the plan, the tickets, their local worktrees and factory branches. Pushed branches and pull requests stay.',
      confirmLabel: 'Reset to draft',
      danger: true,
    });
    if (ok) reset.mutate();
  };
  const askDelete = async () => {
    const ok = await confirmAction({
      title: `Delete “${i.title}”?`,
      description: 'This deletes the initiative and its history, with its local worktrees and factory branches. It cannot be undone.',
      confirmLabel: 'Delete for good',
      danger: true,
    });
    if (ok) remove.mutate();
  };

  return (
    <>
      <PageHeader
        title={i.title}
        status={<InitiativeBadge status={i.status} />}
        meta={
          <>
            <Link to="/projects" title={project.repoPath}>
              <Chip icon={<FolderGit2 />}>{project.name}</Chip>
            </Link>
            <Chip icon={<GitBranch />} mono>
              {i.baseBranch}
            </Chip>
            {!isFeature && <Chip icon={<GitPullRequest />}>Adopted pull requests</Chip>}
            {i.settings.autoMerge && (
              <button type="button" onClick={onAutopilot} title="Each approved PR joins the merge queue once the PRs below it merge. Change it under Autopilot.">
                <Chip icon={<GitMerge />}>Auto-merge on</Chip>
              </button>
            )}
            <Chip>
              <span className="numeric">{money(detail.costUsd)}</span> spent
            </Chip>
            <Chip>Created {ago(i.createdAt)}</Chip>
          </>
        }
        actions={
          <>
            <Button variant="ghost" size="sm" icon={<FileText />} onClick={() => setShowBrief((v) => !v)} aria-expanded={showBrief}>
              {showBrief ? 'Hide the brief' : 'Brief'}
            </Button>
            <Button variant="outline" size="sm" icon={<ClipboardCopy />} loading={report.isPending} onClick={() => report.mutate()}>
              Copy report
            </Button>
            <Menu trigger={<Button variant="outline" size="sm" icon={<MoreHorizontal />} aria-label="More actions" />}>
              {drafts.length > 0 && (
                <MenuItem icon={<GitPullRequest />} disabled={markReady.isPending} onSelect={() => markReady.mutate()} description={`Ready for review: ${drafts.map((t) => `#${t.prNumber}`).join(', ')}`}>
                  {drafts.length > 1 ? `Mark ${drafts.length} PRs ready for review` : `Mark PR #${drafts[0].prNumber} ready for review`}
                </MenuItem>
              )}
              <MenuItem icon={<Wrench />} disabled={!hasOpenPrs || fixPrs.isPending} onSelect={() => fixPrs.mutate()} description="Review comments, failing CI and conflicts">
                Fix the PRs now
              </MenuItem>
              {isFeature && (
                <MenuItem icon={<GraduationCap />} disabled={!i.approvedAt || retro.isPending} onSelect={() => retro.mutate()} description="What you steered by hand, as rules for next time">
                  Run a retro on the plan
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem icon={<Pencil />} onSelect={() => setEditing(true)}>
                Edit the title and brief
              </MenuItem>
              {i.status === 'archived' ? (
                <MenuItem icon={<ArchiveRestore />} onSelect={() => update.mutate({ status: 'draft' })}>
                  Restore
                </MenuItem>
              ) : (
                <MenuItem icon={<Archive />} onSelect={() => update.mutate({ status: 'archived' })} description="Hide it from the overview and the sidebar; restore any time">
                  Archive
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem icon={<RotateCcw />} danger onSelect={askReset} description="Deletes the plan, tickets and branches">
                Reset to draft
              </MenuItem>
              <MenuItem icon={<Trash2 />} danger onSelect={askDelete}>
                Delete
              </MenuItem>
            </Menu>
          </>
        }
      />
      {showBrief && (
        <Card className="-mt-2 mb-6 animate-fade-in px-5 py-4">
          <div className="eyebrow mb-2">Your brief</div>
          <Markdown>{i.brief}</Markdown>
        </Card>
      )}
      <EditDialog detail={detail} open={editing} onOpenChange={setEditing} />
    </>
  );
}

function EditDialog({ detail, open, onOpenChange }: { detail: InitiativeDetail; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { initiative: i } = detail;
  const [title, setTitle] = useState(i.title);
  const [brief, setBrief] = useState(i.brief);
  useEffect(() => {
    if (open) {
      setTitle(i.title);
      setBrief(i.brief);
    }
  }, [open, i]);
  const save = useMutation({
    mutationFn: () => api.updateInitiative(i.id, { title, brief }),
    onSuccess: () => {
      toast.success('Saved. The next planner reads the new brief.');
      onOpenChange(false);
    },
    onError: toastError,
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Edit the initiative"
      description="The next planner reads the brief as it is when it starts."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={title.trim().length < 3 || brief.trim().length < 10} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3" onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && save.mutate()}>
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Brief">
          <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} className="min-h-[14rem] font-mono text-sm" />
        </Field>
      </div>
    </Dialog>
  );
}
