import { RULE_ROLES, RULE_SCOPES, type Message, type Run, type RuleRole, type RuleScope } from '@factory/shared';
import { agentName } from './arbiter.ts';
import type { PrItems } from './pr-replies.ts';
import { section } from './plan.ts';

export const MAX_RULES_PER_RETRO = 3;
const MAX_RULE_LENGTH = 600;
const STEERING_KINDS: Message['kind'][] = ['feedback', 'comment', 'event', 'approval'];
const PLAIN_PLAN_APPROVAL = 'Approved the plan.';

export function isSteering(m: Pick<Message, 'author' | 'kind' | 'body' | 'runId'>, routedBy: ReadonlySet<string>): boolean {
  if (m.author === 'agent') return m.kind === 'feedback' && !!m.runId && routedBy.has(m.runId);
  if (m.author !== 'human' || !STEERING_KINDS.includes(m.kind)) return false;
  if (m.kind === 'event') return !/ as merged\.$/.test(m.body.trim());
  if (m.kind === 'approval') return m.body.trim() !== PLAIN_PLAN_APPROVAL;
  return true;
}

const isBotLogin = (login: string) => /\[bot\]$/i.test(login);

export function hasHumanPrItems(items: PrItems | null): boolean {
  if (!items) return false;
  return items.threads.some((t) => !t.rootIsBot && !isBotLogin(t.rootAuthor)) || items.comments.some((c) => !isBotLogin(c.author));
}

type TimelineRun = Pick<Run, 'kind' | 'round' | 'trigger' | 'model' | 'status' | 'verdict' | 'queuedAt' | 'outputPath' | 'error'>;
type TimelineMessage = Pick<Message, 'author' | 'kind' | 'body' | 'runId' | 'createdAt'>;

const stamp = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
const quoted = (body: string, max: number) => {
  const text = body.trim();
  const cut = text.length > max ? `${text.slice(0, max)}…` : text;
  return `> ${cut.replace(/\n/g, '\n  > ')}`;
};

function runLine(r: TimelineRun): string {
  const outcome = r.status === 'succeeded' ? r.verdict ?? 'done' : [r.status, r.error].filter(Boolean).join(': ');
  const parts = [`${agentName(r.kind)}${r.round ? `, round ${r.round}` : ''}`, r.trigger === 'manual' ? 'started by the owner' : 'auto', r.model, outcome, r.outputPath];
  return parts.filter(Boolean).join(' · ');
}

function messageLine(m: TimelineMessage, routedBy: ReadonlySet<string>): string | null {
  if (isSteering(m, routedBy)) {
    const who = m.author === 'human' ? `**Owner (${m.kind})**` : "**Owner's steering, routed here by an agent**";
    return `${who}:\n  ${quoted(m.body, 1500)}`;
  }
  if (m.author === 'system') return `factory: ${m.body.trim().split('\n')[0].slice(0, 240)}`;
  return null;
}

export function renderTimeline(title: string, runs: TimelineRun[], messages: TimelineMessage[], routedBy: ReadonlySet<string>): string {
  const entries = [
    ...runs.map((r) => ({ at: r.queuedAt, line: runLine(r) })),
    ...messages.flatMap((m) => {
      const line = messageLine(m, routedBy);
      return line ? [{ at: m.createdAt, line }] : [];
    }),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return [`# ${title}`, '', 'Every step in order, oldest first, with what the owner said in between. Lines in bold are the owner steering.', '', ...entries.map((e) => `- ${stamp(e.at)} · ${e.line}`)].join('\n');
}

export interface ProposedRule {
  scope: RuleScope;
  role: RuleRole;
  body: string;
  why: string;
}

const FIELDS = ['Scope', 'Role', 'Rule', 'Why'] as const;
type Field = (typeof FIELDS)[number];

function ruleFields(block: string): Partial<Record<Field, string>> {
  const fields: Partial<Record<Field, string>> = {};
  let current: Field | null = null;
  for (const line of block.split('\n')) {
    const m = /^\s*[-*]?\s*\**(Scope|Role|Rule|Why)\**:\**\s*(.*)$/i.exec(line);
    if (m) {
      current = FIELDS.find((f) => f.toLowerCase() === m[1].toLowerCase())!;
      fields[current] = m[2];
    } else if (current && line.trim()) {
      fields[current] = `${fields[current]} ${line.trim()}`;
    }
  }
  return fields;
}

const token = (v: string | undefined) => (v ?? '').replace(/[`*]/g, '').trim().toLowerCase();
export const oneLine = (text: string) => text.replace(/\s*\n\s*/g, ' ').trim();

export function parseProposedRules(md: string): { rules: ProposedRule[]; dropped: string[] } {
  const body = section(md, 'Rules');
  if (!body) return { rules: [], dropped: [] };
  const blocks = body.split(/^###\s+.*$/m).map((b) => b.trim()).filter(Boolean);
  const rules: ProposedRule[] = [];
  const dropped: string[] = [];
  for (const block of blocks) {
    const f = ruleFields(block);
    const scope = token(f.Scope) as RuleScope;
    const role = token(f.Role) as RuleRole;
    const text = oneLine(f.Rule ?? '');
    const problem = !RULE_SCOPES.includes(scope)
      ? `unknown scope "${f.Scope ?? ''}"`
      : !RULE_ROLES.includes(role)
        ? `unknown role "${f.Role ?? ''}"`
        : !text
          ? 'no rule text'
          : text.length > MAX_RULE_LENGTH
            ? `rule longer than ${MAX_RULE_LENGTH} characters`
            : rules.length >= MAX_RULES_PER_RETRO
              ? `more than ${MAX_RULES_PER_RETRO} rules`
              : null;
    if (problem) dropped.push(`${problem}: ${oneLine(block).slice(0, 160)}`);
    else rules.push({ scope, role, body: text, why: oneLine(f.Why ?? '') });
  }
  return { rules, dropped };
}

const LEARNED_HEADING = '## Learned rules';
const LEARNED_INTRO = "The owner accepted these after reviewing the factory's work. They bind like the rest of this prompt.";
const bulletOf = (body: string) => `- ${oneLine(body)}`;

export function withLearnedRule(content: string, body: string): string {
  const bullet = bulletOf(body);
  const lines = content.replace(/\s+$/, '').split('\n');
  if (lines.includes(bullet)) return `${lines.join('\n')}\n`;
  const at = lines.indexOf(LEARNED_HEADING);
  if (at === -1) return `${[...lines, '', LEARNED_HEADING, '', LEARNED_INTRO, '', bullet].join('\n')}\n`;
  let end = lines.findIndex((l, i) => i > at && /^#{1,2}\s/.test(l));
  if (end === -1) end = lines.length;
  while (end > at + 1 && !lines[end - 1].trim()) end--;
  lines.splice(end, 0, bullet);
  return `${lines.join('\n')}\n`;
}

export function withoutLearnedRule(content: string, body: string): string {
  const bullet = bulletOf(body);
  return content
    .split('\n')
    .filter((l) => l !== bullet)
    .join('\n');
}

export function renderProjectRules(rules: Pick<ProposedRule, 'body'>[]): string | null {
  if (!rules.length) return null;
  return ['## Rules learned in this project', '', 'The owner accepted these after reviewing earlier work in this repo. They bind like the rest of this prompt.', '', ...rules.map((r) => bulletOf(r.body))].join('\n');
}

export function retroSummary(md: string): string {
  return section(md, 'Summary') ?? '';
}
