import fs from 'node:fs';
import path from 'node:path';
import type { Initiative, Message, Project, Ticket } from '@factory/shared';
import { config } from '../config.ts';
import { seqLabel, ticketLabel } from './labels.ts';
import { slugify } from './plan.ts';

function initiativeFolder(i: Pick<Initiative, 'id' | 'slug'>): string {
  return `${i.slug}-${i.id.slice(0, 8)}`;
}

export function initiativeDir(i: Initiative): string {
  return path.join(config.home, 'initiatives', initiativeFolder(i));
}

export function planRoundDir(i: Initiative, round: number): string {
  return path.join(initiativeDir(i), 'plan', `round-${round}`);
}

export function ticketDir(i: Initiative, t: Ticket): string {
  return path.join(initiativeDir(i), 'tickets', `${seqLabel(t.seq)}-${t.key}`);
}

export function ticketRoundDir(i: Initiative, t: Ticket, round: number): string {
  return path.join(ticketDir(i, t), `round-${round}`);
}

export function askDir(i: Initiative, runId: string): string {
  return path.join(initiativeDir(i), 'ask', runId.slice(0, 8));
}

export function arbiterDir(i: Initiative, t: Ticket | null, runId: string): string {
  return path.join(t ? ticketDir(i, t) : path.join(initiativeDir(i), 'plan'), 'arbiter', runId.slice(0, 8));
}

export function steerDir(i: Initiative, runId: string): string {
  return path.join(initiativeDir(i), 'steer', runId.slice(0, 8));
}

export function retroDir(i: Initiative, t: Ticket | null, runId: string): string {
  return path.join(t ? ticketDir(i, t) : initiativeDir(i), 'retro', runId.slice(0, 8));
}

export function spoolRoot(): string {
  return path.join(config.home, 'spool');
}

export function spoolDir(runId: string): string {
  return path.join(spoolRoot(), runId);
}

export function stoppedOnPurposeMark(): string {
  return path.join(config.home, 'stopped-on-purpose');
}

/** Per-ticket build count and the PR a rebuild keeps; outside the ticket folder, which a reset wipes. */
export function rebuildStateFile(i: Initiative, ticketId: string): string {
  return path.join(initiativeDir(i), 'rebuilds', `${ticketId}.json`);
}

/** Read-only checkouts of the project's base branches at origin's commit, shared by its initiatives. */
export function baseCheckoutsDir(p: Project): string {
  return path.join(config.home, 'worktrees', slugify(p.name, 30), '_base');
}

export function worktreePath(p: Project, i: Initiative, t: Ticket): string {
  return path.join(config.home, 'worktrees', slugify(p.name, 30), initiativeFolder(i), `${seqLabel(t.seq)}-${t.key}`);
}

export function branchName(i: Initiative, t: Ticket): string {
  return `${initiativeBranchPrefix(i)}${seqLabel(t.seq)}-${t.key}`;
}

/** Every branch the initiative builds, rebuilds included, starts with this. */
export function initiativeBranchPrefix(i: Pick<Initiative, 'id' | 'slug'>): string {
  return `factory/${initiativeFolder(i)}/`;
}

export function write(file: string, content: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content.endsWith('\n') ? content : `${content}\n`);
  return file;
}

export function readIfExists(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function renderBrief(i: Initiative, p: Project): string {
  return [
    `# Brief: ${i.title}`,
    '',
    `Project: ${p.name} (${p.repoPath})`,
    `Base branch: ${i.baseBranch}`,
    '',
    'What the project owner asked for, in their words:',
    '',
    i.brief.trim(),
    ...(p.notes?.trim() ? ['', '## Project notes from the owner', '', p.notes.trim()] : []),
  ].join('\n');
}

export function renderTicket(t: Ticket, all: Ticket[]): string {
  const describe = (d: Ticket) => `${ticketLabel(d)} (key ${d.key}, branch ${d.branch ?? 'not started'}, ${d.status})`;
  const live = (x: Ticket) => x.id !== t.id && x.status !== 'canceled' && x.status !== 'proposed';
  const deps = t.dependsOn
    .map((k) => all.find((x) => x.key === k))
    .filter((d): d is Ticket => !!d)
    .map(describe);
  const beside = t.dependsOn.length ? all.filter((x) => live(x) && x.dependsOn[0] === t.dependsOn[0] && x.status !== 'merged') : [];
  const onTop = all.filter((x) => live(x) && x.dependsOn.includes(t.key));
  return [
    `# ${ticketLabel(t)}`,
    '',
    `Key: ${t.key} · Size: ${t.size ?? '?'} · Wave: ${t.wave}`,
    '',
    '## What happens',
    t.what,
    '',
    '## Goal',
    t.goal,
    '',
    '## Measurable outcome',
    t.outcome,
    '',
    '## Depends on',
    deps.length ? deps.map((d) => `- ${d}`).join('\n') : 'Nothing.',
    '',
    ...(beside.length
      ? [
          '## Built beside it',
          'These tickets stack on the same ticket and are built at the same time, each on its own branch and PR. Keep out of the code they add.',
          beside.map((x) => `- ${describe(x)}`).join('\n'),
          '',
        ]
      : []),
    ...(onTop.length
      ? [
          '## Built on top of it',
          'These tickets stack on this one and use the interfaces it adds.',
          onTop.map((x) => `- ${describe(x)}`).join('\n'),
          '',
        ]
      : []),
    ...(t.foundation ? ['## Foundation', 'Other tickets build on what this one defines. Its dependents wait until it is approved and green, so get the contract right here.', ''] : []),
    ...(t.touches?.length
      ? [
          '## Files this ticket owns',
          'The plan gives these files to this ticket. Change what the ticket needs here; a file another ticket of the stack owns is changed there, not here.',
          t.touches.map((p) => `- \`${p}\``).join('\n'),
          '',
        ]
      : []),
    '## Guidance for the agent',
    t.guidance.map((g) => `- ${g}`).join('\n'),
    '',
    '## Acceptance checks',
    t.acceptance.map((a, n) => `${n + 1}. ${a}`).join('\n'),
  ].join('\n');
}

const FEEDBACK_SOURCE: Record<Message['author'], string> = { human: 'The owner', agent: "An agent, on the owner's behalf", system: 'The factory' };
const SPEAKER: Record<Message['author'], string> = { human: 'Owner', agent: 'Agent', system: 'System' };

export function renderFeedback(msgs: Message[], title: string): string {
  return [
    `# ${title}`,
    '',
    'The project owner wrote this, or an arbiter decided it on their behalf. It is binding on product decisions; still check it against the code.',
    '',
    ...msgs.map((m) => `## ${FEEDBACK_SOURCE[m.author]}, ${new Date(m.createdAt).toISOString()}\n\n${m.body.trim()}\n`),
  ].join('\n');
}

function renderMessages(msgs: Message[]): string[] {
  return msgs
    .slice(-30)
    .filter((m) => m.kind !== 'event')
    .flatMap((m) => [`### ${SPEAKER[m.author]} (${m.kind})`, '', m.body.trim(), '']);
}

export function renderConversation(msgs: Message[], question: string): string {
  return ['# Conversation so far', '', ...renderMessages(msgs), '# The question to answer now', '', question.trim()].join('\n');
}

export function renderOwnerHistory(msgs: Message[]): string {
  return ['# What the owner and earlier arbiter decisions said here', '', ...renderMessages(msgs)].join('\n');
}

export function writeBrief(i: Initiative, p: Project): string {
  return write(path.join(initiativeDir(i), 'brief.md'), renderBrief(i, p));
}

export function writePlanMd(i: Initiative): string {
  return write(path.join(initiativeDir(i), 'plan.md'), i.planMd ?? '');
}

export function writeTicket(i: Initiative, t: Ticket, all: Ticket[]): string {
  return write(path.join(ticketDir(i, t), 'ticket.md'), renderTicket(t, all));
}

export function writeFeedback(dir: string, msgs: Message[], subject: string): string {
  return write(path.join(dir, 'feedback.md'), renderFeedback(msgs, `Owner feedback on ${subject}`));
}
