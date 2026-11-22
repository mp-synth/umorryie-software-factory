import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, GraduationCap, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { RULE_ROLES, RULE_SCOPES, type InitiativeDetail, type Rule, type RuleRole, type RuleScope } from '@factory/shared';
import { api } from '@/lib/api';
import { toastError } from '@/lib/toasts';
import { ago, pad2 } from '@/lib/utils';
import { Button, Card, CardHeader, Chip, Select, Textarea } from './ui';

const ROLE_LABELS: Record<RuleRole, string> = {
  all: 'every agent',
  code: 'agents that write or judge code',
  writing: 'agents that write for people',
  planner: 'planner',
  'plan-reviewer': 'plan reviewer',
  executor: 'executor',
  reviewer: 'reviewer',
  fixer: 'fixer',
  verifier: 'fix verifier',
  arbiter: 'arbiter',
};

const SCOPE_LABELS: Record<RuleScope, string> = { project: 'this project', factory: 'every project' };

const STATUS_LABELS: Record<Rule['status'], string> = { proposed: 'proposed', accepted: 'accepted', rejected: 'rejected', retired: 'retired' };

export function RulesCard({ detail }: { detail: InitiativeDetail }) {
  const { project, tickets } = detail;
  const own = detail.rules ?? [];
  const projectRules = useQuery({ queryKey: ['projects', project.id, 'rules'], queryFn: () => api.projectRules(project.id), retry: false });
  const active = (projectRules.data ?? []).filter((r) => r.status === 'accepted');
  const proposed = own.filter((r) => r.status === 'proposed');
  const decided = own.filter((r) => r.status !== 'proposed');
  const [showActive, setShowActive] = useState(false);
  if (!own.length && !active.length) return null;
  const source = (r: Rule) => {
    const t = r.ticketId ? tickets.find((x) => x.id === r.ticketId) : null;
    return t ? `retro on ${pad2(t.seq)}` : 'retro on the plan';
  };
  return (
    <Card>
      <CardHeader
        icon={<GraduationCap className="h-3.5 w-3.5" />}
        title="Learned rules"
        sub={proposed.length ? `${proposed.length} waiting for you. Nothing changes until you accept.` : 'What retros learned from your steering'}
      />
      <div className="divide-y divide-line">
        {proposed.map((r) => (
          <ProposedRule key={r.id} rule={r} source={source(r)} />
        ))}
        {decided.map((r) => (
          <div key={r.id} className="px-4 py-2 text-2xs text-zinc-500">
            <span className="text-zinc-400">{STATUS_LABELS[r.status]}</span> · {SCOPE_LABELS[r.scope]} · {ROLE_LABELS[r.role]} · {r.body}
          </div>
        ))}
        {active.length > 0 && (
          <div className="px-4 py-2.5">
            <button onClick={() => setShowActive((v) => !v)} className="text-2xs text-zinc-400 hover:text-zinc-200">
              {showActive ? 'Hide' : 'Show'} {active.length} rule{active.length > 1 ? 's' : ''} active in {project.name}
            </button>
            {showActive && (
              <div className="mt-2 space-y-2">
                {active.map((r) => (
                  <ActiveRule key={r.id} rule={r} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function RuleChips({ rule }: { rule: Pick<Rule, 'scope' | 'role'> }) {
  return (
    <div className="flex flex-wrap gap-1">
      <Chip>{SCOPE_LABELS[rule.scope]}</Chip>
      <Chip>{ROLE_LABELS[rule.role]}</Chip>
    </div>
  );
}

function ProposedRule({ rule, source }: { rule: Rule; source: string }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(rule.body);
  const [scope, setScope] = useState<RuleScope>(rule.scope);
  const [role, setRole] = useState<RuleRole>(rule.role);
  const accept = useMutation({
    mutationFn: () => api.acceptRule(rule.id, editing ? { body, scope, role } : {}),
    onSuccess: (r) => toast.success(r.scope === 'factory' ? 'Accepted: added to the role file, every project gets it' : 'Accepted: every matching agent in this project gets it'),
    onError: toastError,
  });
  const reject = useMutation({ mutationFn: () => api.rejectRule(rule.id), onSuccess: () => toast.success('Rejected: retros won’t propose it again'), onError: toastError });
  return (
    <div className="space-y-2 px-4 py-3">
      {editing ? (
        <div className="space-y-2">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[72px] text-xs" />
          <div className="grid grid-cols-2 gap-2">
            <Select value={scope} onChange={(e) => setScope(e.target.value as RuleScope)} className="h-7 text-2xs">
              {RULE_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {SCOPE_LABELS[s]}
                </option>
              ))}
            </Select>
            <Select value={role} onChange={(e) => setRole(e.target.value as RuleRole)} className="h-7 text-2xs">
              {RULE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </div>
        </div>
      ) : (
        <>
          <RuleChips rule={rule} />
          <p className="text-xs leading-relaxed text-zinc-200">{rule.body}</p>
          {rule.why && <p className="text-2xs leading-relaxed text-zinc-500">{rule.why}</p>}
        </>
      )}
      <div className="flex items-center gap-1.5">
        <Button size="xs" variant="success" icon={<Check className="h-3 w-3" />} loading={accept.isPending} disabled={!body.trim()} onClick={() => accept.mutate()}>
          {editing ? 'Save & accept' : 'Accept'}
        </Button>
        {!editing && (
          <Button size="xs" variant="ghost" icon={<Pencil className="h-3 w-3" />} onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
        <Button size="xs" variant="ghost" icon={<X className="h-3 w-3" />} loading={reject.isPending} onClick={() => (editing ? setEditing(false) : reject.mutate())}>
          {editing ? 'Cancel' : 'Reject'}
        </Button>
        <span className="ml-auto text-2xs text-zinc-600">
          {source} · {ago(rule.createdAt)}
        </span>
      </div>
    </div>
  );
}

function ActiveRule({ rule }: { rule: Rule }) {
  const retire = useMutation({ mutationFn: () => api.retireRule(rule.id), onSuccess: () => toast.success('Retired: agents no longer get it'), onError: toastError });
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1 space-y-1">
        <RuleChips rule={rule} />
        <p className="text-2xs leading-relaxed text-zinc-300">{rule.body}</p>
      </div>
      <Button
        size="xs"
        variant="ghost"
        loading={retire.isPending}
        onClick={() => {
          if (confirm('Retire this rule? Agents stop getting it from the next step on.')) retire.mutate();
        }}
      >
        Retire
      </Button>
    </div>
  );
}
