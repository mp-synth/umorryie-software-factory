import { isBot } from '../github.ts';
import { section } from './plan.ts';

export interface PrItems {
  prNumber: number;
  threads: { label: string; id: string; rootCommentId: number; rootAuthor: string; rootIsBot?: boolean }[];
  comments: { label: string; url: string; author: string }[];
}

export interface Reply {
  item: string;
  verdict: string;
  body: string;
}

const REPLY_LINE = /^[-*]\s*\*{0,2}([A-Z]+[\d.]*)\*{0,2}\s*\[([A-Z-]+)\]\s*:\s*(.+)$/;

export function parseReplies(md: string): { replies: Reply[]; unparsed: number } {
  const lines = (section(md, 'Replies') ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const matches = lines.map((line) => REPLY_LINE.exec(line));
  return {
    replies: matches
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ item: m[1], verdict: m[2].toUpperCase(), body: m[3].trim() })),
    unparsed: matches.filter((m) => !m).length,
  };
}

export function parseRerunIds(md: string): { ids: string[]; unparsed: number } {
  const lines = (section(md, 'Reruns') ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const found = lines.map((line) => line.match(/\b\d{6,}\b/g) ?? []);
  return { ids: [...new Set(found.flat())], unparsed: found.filter((ids) => !ids.length).length };
}

export function shouldResolve(reply: Reply, root: Pick<PrItems['threads'][number], 'rootAuthor' | 'rootIsBot'>): boolean {
  return reply.verdict === 'VALID' || ((root.rootIsBot ?? isBot(root.rootAuthor)) && reply.verdict === 'INVALID');
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
  return `- [@${comment.author}](${comment.url}): ${reply.body}`;
}

export function planReplies(replies: Reply[], items: PrItems | null): PlannedReplies {
  const planned: PlannedReplies = { threadReplies: [], commentReplies: [] };
  for (const reply of replies) {
    const thread = items?.threads.find((t) => t.label === reply.item);
    if (thread) {
      planned.threadReplies.push({ thread, reply, resolve: shouldResolve(reply, thread) });
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
