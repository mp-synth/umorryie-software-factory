import fs from 'node:fs';
import path from 'node:path';
import type { Initiative, Message, Project, Ticket } from '@factory/shared';
import { config } from '../config.ts';
import { seqLabel, ticketLabel } from './labels.ts';
import { slugify } from './plan.ts';

function initiativeFolder(i: Initiative): string {
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

export function worktreePath(p: Project, i: Initiative, t: Ticket): string {
  return path.join(config.home, 'worktrees', slugify(p.name, 30), initiativeFolder(i), `${seqLabel(t.seq)}-${t.key}`);
}

export function branchName(i: Initiative, t: Ticket): string {
  return `factory/${initiativeFolder(i)}/${seqLabel(t.seq)}-${t.key}`;
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
  const deps = t.dependsOn
    .map((k) => all.find((x) => x.key === k))
    .filter(Boolean)
    .map((d) => `${ticketLabel(d!)} (key ${d!.key}, branch ${d!.branch ?? 'not started'}, ${d!.status})`);
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
    '## Guidance for the agent',
    t.guidance.map((g) => `- ${g}`).join('\n'),
    '',
    '## Acceptance checks',
    t.acceptance.map((a, n) => `${n + 1}. ${a}`).join('\n'),
  ].join('\n');
}

const FEEDBACK_SOURCE: Record<Message['author'], string> = { human: 'The owner', agent: "The arbiter, on the owner's behalf", system: 'The factory' };
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
