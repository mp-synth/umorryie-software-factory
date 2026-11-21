import { isBot } from '../github.ts';
import { section } from './plan.ts';

export interface PrItems {
  prNumber: number;
  threads: { label: string; id: string; rootCommentId: number; rootAuthor: string }[];
  comments: { label: string; url: string; author: string }[];
}

export interface Reply {
  item: string;
  verdict: string;
  body: string;
}

const REPLY_LINE = /^[-*]\s*\*{0,2}([A-Z]+[\d.]*)\*{0,2}\s*\[([A-Z-]+)\]\s*:\s*(.+)$/;

export function parseReplies(md: string): Reply[] {
  const replies = section(md, 'Replies');
  if (!replies) return [];
  return replies
    .split('\n')
    .map((line) => REPLY_LINE.exec(line.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ item: m[1], verdict: m[2].toUpperCase(), body: m[3].trim() }));
}

export function parseRerunIds(md: string): string[] {
  const reruns = section(md, 'Reruns');
  if (!reruns) return [];
  return [...new Set(reruns.match(/\b\d{6,}\b/g) ?? [])];
}

export function shouldResolve(reply: Reply, rootAuthor: string): boolean {
  return isBot(rootAuthor) && (reply.verdict === 'VALID' || reply.verdict === 'INVALID');
}

type PrComment = PrItems['comments'][number];

export interface PlannedReplies {
  threadReplies: { thread: PrItems['threads'][number]; reply: Reply; resolve: boolean }[];
  commentReplies: { comment: PrComment; reply: Reply }[];
}

export function commentKey(c: PrComment): string {
  return c.label.startsWith('V') ? `${c.url}#${c.author}#${c.label}` : c.url;
}

export function renderCommentReply({ comment, reply }: PlannedReplies['commentReplies'][number]): string {
  return `- Re @${comment.author} (${comment.url}): ${reply.body}`;
}

export function planReplies(replies: Reply[], items: PrItems | null): PlannedReplies {
  const planned: PlannedReplies = { threadReplies: [], commentReplies: [] };
  for (const reply of replies) {
    const thread = items?.threads.find((t) => t.label === reply.item);
    if (thread) {
      planned.threadReplies.push({ thread, reply, resolve: shouldResolve(reply, thread.rootAuthor) });
      continue;
    }
    const comment = items?.comments.find((c) => c.label === reply.item);
    if (comment) planned.commentReplies.push({ comment, reply });
  }
  return planned;
}

export function mergeNewestFirst(rounds: PlannedReplies[]): PlannedReplies {
  const merged: PlannedReplies = { threadReplies: [], commentReplies: [] };
  for (const round of rounds) {
    for (const r of round.threadReplies) {
      if (!merged.threadReplies.some((m) => m.thread.rootCommentId === r.thread.rootCommentId)) merged.threadReplies.push(r);
    }
    for (const r of round.commentReplies) {
      if (!merged.commentReplies.some((m) => commentKey(m.comment) === commentKey(r.comment))) merged.commentReplies.push(r);
    }
  }
  return merged;
}
