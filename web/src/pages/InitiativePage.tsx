import { useMutation, useQuery } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ChevronLeft, ClipboardCopy, FileText, FolderGit2, GitBranch, MoreHorizontal, Pencil, RotateCcw, Trash2, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { InitiativeDetail } from '@factory/shared';
import { api, ApiError } from '@/lib/api';
import { toastError, toastSuccess } from '@/lib/toasts';
import { ago, copy, money, shortPath } from '@/lib/utils';
import { AutopilotCard } from '@/components/AutopilotCard';
import { Conversation } from '@/components/Conversation';
import { Markdown } from '@/components/Markdown';
import { PipelineStrip } from '@/components/PipelineStrip';
import { PlanPanel } from '@/components/PlanPanel';
import { InitiativePill } from '@/components/StatusPill';
import { TicketList } from '@/components/TicketList';
import { Button, Chip, Dialog, EmptyState, Field, Input, Menu, MenuItem, MenuSeparator, Skeleton, Textarea } from '@/components/ui';

export function InitiativePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading } = useQuery({ queryKey: ['initiative', id], queryFn: () => api.initiative(id!), enabled: !!id });

  useEffect(() => {
    if (data) document.title = `${data.initiative.title} · Software Factory`;
    return () => {
      document.title = 'Software Factory';
    };
  }, [data]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-4 px-8 py-8">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-16" />
        <Skeleton className="h-80" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <EmptyState title={error instanceof ApiError && error.status === 404 ? 'Initiative not found' : 'Could not load the initiative'} action={<Link to="/"><Button>Back to dashboard</Button></Link>}>
        {(error as Error)?.message}
      </EmptyState>
    );
  }
  return <Initiative detail={data} />;
}

function Initiative({ detail }: { detail: InitiativeDetail }) {
  const { initiative: i, project } = detail;
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [showBrief, setShowBrief] = useState(false);

  const update = useMutation({
    mutationFn: (p: { status?: 'archived' | 'draft' }) => api.updateInitiative(i.id, p),
    onSuccess: (_r, p) => toast.success(p.status === 'archived' ? 'Archived' : 'Restored'),
    onError: toastError,
  });
  const reset = useMutation({
    mutationFn: () => api.resetInitiative(i.id),
    onSuccess: toastSuccess('Reset to draft'),
    onError: toastError,
  });
  const copyReport = useMutation({
    mutationFn: () => api.reportMarkdown(i.id).then(copy),
    onSuccess: toastSuccess('Report copied'),
    onError: toastError,
  });
  const fixPrs = useMutation({
    mutationFn: () => api.bulk(i.id, 'fix-prs'),
    onSuccess: ({ count }) => toast.success(count ? `Started a fixer on ${count} PR${count > 1 ? 's' : ''}` : 'No open PR has anything to fix right now'),
    onError: toastError,
  });
  const hasOpenPrs = detail.tickets.some((t) => t.prNumber && t.prState !== 'MERGED' && t.prState !== 'CLOSED');
  const remove = useMutation({
    mutationFn: () => api.deleteInitiative(i.id),
    onSuccess: () => {
      toast.success('Initiative deleted');
      navigate('/');
    },
    onError: toastError,
  });

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6 lg:px-8">
      <div className="mb-5">
        <Link to="/" className="mb-3 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
          <ChevronLeft className="h-3.5 w-3.5" /> Dashboard
        </Link>
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight text-zinc-50">{i.title}</h1>
              <InitiativePill status={i.status} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Chip title={project.repoPath}>
                <FolderGit2 className="h-3 w-3" /> {project.name}
              </Chip>
              <Chip>
                <GitBranch className="h-3 w-3" /> {i.baseBranch}
              </Chip>
              <Chip>{money(detail.costUsd)} spent</Chip>
              <Chip>created {ago(i.createdAt)}</Chip>
              <button onClick={() => setShowBrief((v) => !v)} className="mono-chip hover:text-zinc-200">
                <FileText className="h-3 w-3" /> {showBrief ? 'Hide brief' : 'Brief'}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" icon={<ClipboardCopy className="h-4 w-4" />} loading={copyReport.isPending} onClick={() => copyReport.mutate()}>
              Copy report
            </Button>
            <Menu
              trigger={
                <Button variant="outline" size="sm" icon={<MoreHorizontal className="h-4 w-4" />}>
                  More
                </Button>
              }
            >
              <MenuItem icon={<Wrench />} disabled={!hasOpenPrs || fixPrs.isPending} onSelect={() => fixPrs.mutate()}>
                <span className="block">Fix PRs now</span>
                <span className="block text-2xs text-zinc-500">Review comments, failing CI, conflicts</span>
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Pencil />} onSelect={() => setEditing(true)}>
                Edit title & brief
              </MenuItem>
              {i.status === 'archived' ? (
                <MenuItem icon={<ArchiveRestore />} onSelect={() => update.mutate({ status: 'draft' })}>
                  Restore
                </MenuItem>
              ) : (
                <MenuItem icon={<Archive />} onSelect={() => update.mutate({ status: 'archived' })}>
                  Archive
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem
                icon={<RotateCcw />}
                danger
                onSelect={() => {
                  if (confirm('Reset to draft? This stops all agents and deletes the plan, tickets, local worktrees and factory branches. Pushed branches and PRs stay.')) reset.mutate();
                }}
              >
                Reset to draft
              </MenuItem>
              <MenuItem
                icon={<Trash2 />}
                danger
                onSelect={() => {
                  if (confirm('Delete this initiative and its history? Local worktrees and factory branches are removed too. This cannot be undone.')) remove.mutate();
                }}
              >
                Delete
              </MenuItem>
            </Menu>
          </div>
        </div>
        {showBrief && (
          <div className="card mt-3 animate-fade-in px-4 py-3">
            <Markdown>{i.brief}</Markdown>
          </div>
        )}
      </div>

      <PipelineStrip detail={detail} />

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <PlanPanel detail={detail} />
          <TicketList detail={detail} />
        </div>
        <div className="space-y-5 xl:sticky xl:top-5 xl:self-start">
          <Conversation detail={detail} />
          <AutopilotCard initiative={i} />
          <div className="px-1 text-2xs leading-relaxed text-zinc-600">
            Agents never touch <span className="font-mono">{shortPath(project.repoPath)}</span> directly: each ticket gets its own worktree and{' '}
            <span className="font-mono">factory/*</span> branch. Every step is a fresh <span className="font-mono">claude -p</span> process.
          </div>
        </div>
      </div>

      <EditDialog detail={detail} open={editing} onOpenChange={setEditing} />
    </div>
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
      wide
      title="Edit initiative"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Brief">
          <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} className="min-h-[220px] font-mono text-xs" />
        </Field>
      </div>
    </Dialog>
  );
}
