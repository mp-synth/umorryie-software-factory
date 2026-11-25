import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, GraduationCap, Pencil, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { RULE_ROLES, RULE_SCOPES, type InitiativeDetail, type Rule, type RuleRole, type RuleScope } from '@factory/shared';
import { api } from '@/lib/api';
import { toastError } from '@/lib/toasts';
import { ago, pad2 } from '@/lib/utils';
import { useRunDock } from './dock/use-run-dock';
import { Badge, Button, Card, CardHeader, Chip, EmptyState, Select, Textarea, confirmAction } from './ui';

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

const STATUS_TONES = { proposed: 'warn', accepted: 'good', rejected: 'muted', retired: 'muted' } as const;

function RuleScopeChips({ rule }: { rule: Pick<Rule, 'scope' | 'role'> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Chip>For {SCOPE_LABELS[rule.scope]}</Chip>
      <Chip>Given to {ROLE_LABELS[rule.role]}</Chip>
    </div>
  );
}

/** A retro cites the finding a rule came from by its number in the retro's output; anything longer is the reason itself. */
function RuleWhy({ rule }: { rule: Rule }) {
  const dock = useRunDock();
  if (!rule.why) return null;
  if (!/^\d+$/.test(rule.why)) return <p className="text-pretty text-xs leading-relaxed text-ink-secondary">Why: {rule.why}</p>;
  if (!rule.runId) return null;
  return (
    <button type="button" onClick={() => dock.watch(rule.runId!)} className="text-xs font-medium text-ink-accent hover:underline">
      Why: finding {rule.why} of the retro
    </button>
  );
}

/** A rule a retro proposed: nothing changes until the user accepts it, as written or edited. */
export function ProposedRule({ rule, source }: { rule: Rule; source: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(rule.body);
  const [scope, setScope] = useState<RuleScope>(rule.scope);
  const [role, setRole] = useState<RuleRole>(rule.role);
  const accept = useMutation({
    mutationFn: () => api.acceptRule(rule.id, editing ? { body, scope, role } : {}),
    onSuccess: (r) => toast.success(r.scope === 'factory' ? 'Accepted: added to the role file, so every project gets it' : 'Accepted: every matching agent in this project gets it'),
    onError: toastError,
  });
  const reject = useMutation({ mutationFn: () => api.rejectRule(rule.id), onSuccess: () => toast.success('Rejected: retros won’t propose it again'), onError: toastError });
  return (
    <div className="space-y-3 px-4 py-4">
      {editing ? (
        <div className="space-y-2">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[5rem] text-sm" aria-label="Rule" />
          <div className="grid grid-cols-2 gap-2">
            <Select size="sm" value={scope} onChange={(e) => setScope(e.target.value as RuleScope)} aria-label="Applies to">
              {RULE_SCOPES.map((s) => (
                <option key={s} value={s}>
                  For {SCOPE_LABELS[s]}
                </option>
              ))}
            </Select>
            <Select size="sm" value={role} onChange={(e) => setRole(e.target.value as RuleRole)} aria-label="Given to">
              {RULE_ROLES.map((r) => (
                <option key={r} value={r}>
                  Given to {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </div>
        </div>
      ) : (
        <>
          <p className="text-pretty text-sm leading-relaxed text-ink">{rule.body}</p>
          <RuleWhy rule={rule} />
          <RuleScopeChips rule={rule} />
        </>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="primary" icon={<Check />} loading={accept.isPending} disabled={!body.trim()} onClick={() => accept.mutate()}>
          {editing ? 'Save and accept' : 'Accept'}
        </Button>
        {!editing && (
          <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => setEditing(true)}>
            Edit first
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<X />} loading={reject.isPending} onClick={() => (editing ? setEditing(false) : reject.mutate())}>
          {editing ? 'Cancel' : 'Reject'}
        </Button>
        <span className="ml-auto text-xs text-ink-tertiary">
          {source} · {ago(rule.createdAt)}
        </span>
      </div>
    </div>
  );
}

function ActiveRule({ rule }: { rule: Rule }) {
  const retire = useMutation({ mutationFn: () => api.retireRule(rule.id), onSuccess: () => toast.success('Retired: agents no longer get it'), onError: toastError });
  const ask = async () => {
    const ok = await confirmAction({ title: 'Retire this rule?', description: 'Agents stop getting it from their next step on. You can’t undo this, but a retro may propose it again.', confirmLabel: 'Retire rule', danger: true });
    if (ok) retire.mutate();
  };
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-pretty text-sm leading-relaxed text-ink">{rule.body}</p>
        <RuleScopeChips rule={rule} />
      </div>
      <Button size="sm" variant="ghost" loading={retire.isPending} onClick={ask}>
        Retire
      </Button>
    </li>
  );
}

export function RulesPanel({ detail }: { detail: InitiativeDetail }) {
  const { project, tickets } = detail;
  const own = detail.rules ?? [];
  const projectRules = useQuery({ queryKey: ['projects', project.id, 'rules'], queryFn: () => api.projectRules(project.id), retry: false });
  const active = (projectRules.data ?? []).filter((r) => r.status === 'accepted');
  const proposed = own.filter((r) => r.status === 'proposed');
  const decided = own.filter((r) => r.status !== 'proposed');
  const source = (r: Rule) => {
    const t = r.ticketId ? tickets.find((x) => x.id === r.ticketId) : null;
    return t ? `Retro on ${pad2(t.seq)}` : 'Retro on the plan';
  };

  if (!own.length && !active.length) {
    return (
      <Card>
        <EmptyState icon={<GraduationCap />} title="No learned rules yet">
          When you steer agents by hand, a retro proposes rules so you don’t have to say it again. It runs once a PR you steered merges (Autopilot → Retro), or from the
          menu on the initiative or a ticket.
        </EmptyState>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {proposed.length > 0 && (
        <Card className="border-tone-warn-line">
          <CardHeader
            icon={<GraduationCap />}
            title={`${proposed.length} rule${proposed.length > 1 ? 's' : ''} waiting for you`}
            description="What retros learned from your steering. Nothing changes until you accept."
          />
          <div className="divide-y divide-line-subtle">
            {proposed.map((r) => (
              <ProposedRule key={r.id} rule={r} source={source(r)} />
            ))}
          </div>
        </Card>
      )}
      {active.length > 0 && (
        <Card>
          <CardHeader title={`Active in ${project.name}`} description={`${active.length} rule${active.length > 1 ? 's' : ''} every matching agent gets`} />
          <ul className="divide-y divide-line-subtle">
            {active.map((r) => (
              <ActiveRule key={r.id} rule={r} />
            ))}
          </ul>
        </Card>
      )}
      {decided.length > 0 && (
        <Card>
          <CardHeader title="Decided from this initiative" />
          <ul className="divide-y divide-line-subtle">
            {decided.map((r) => (
              <li key={r.id} className="flex items-start gap-3 px-4 py-3">
                <Badge tone={STATUS_TONES[r.status]}>{r.status}</Badge>
                <span className="min-w-0 flex-1 text-sm text-ink-secondary">{r.body}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
