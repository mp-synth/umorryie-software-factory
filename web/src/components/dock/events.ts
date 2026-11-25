import type { RunEvent } from '@factory/shared';
import type { ActivityDetail } from '@/lib/preferences';
import { shortPath } from '@/lib/utils';

export type FeedItem =
  | { type: 'event'; e: RunEvent }
  | { type: 'tool'; use: RunEvent; result?: RunEvent }
  | { type: 'logs'; lines: RunEvent[] }
  | { type: 'steps'; id: string; tools: string[] };

/** What a summary keeps: what the agent said and how it ended. Everything else folds into step counts. */
const SUMMARY_EVENTS = new Set(['text', 'result', 'stderr']);

export function buildItems(events: RunEvent[], detail: ActivityDetail): FeedItem[] {
  const items: FeedItem[] = [];
  const toolIndex = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'tool_use') {
      toolIndex.set(String(e.data.id), items.length);
      items.push({ type: 'tool', use: e });
    } else if (e.type === 'tool_result') {
      const item = items[toolIndex.get(String(e.data.toolUseId)) ?? -1];
      if (item?.type === 'tool') item.result = e;
    } else if (e.type === 'log') {
      const last = items[items.length - 1];
      if (last?.type === 'logs') last.lines.push(e);
      else items.push({ type: 'logs', lines: [e] });
    } else {
      items.push({ type: 'event', e });
    }
  }
  return detail === 'summary' ? summarize(items) : items;
}

function summarize(items: FeedItem[]): FeedItem[] {
  const out: FeedItem[] = [];
  for (const item of items) {
    if (item.type === 'event' && SUMMARY_EVENTS.has(item.e.type)) {
      out.push(item);
      continue;
    }
    if (item.type !== 'tool') continue;
    const last = out[out.length - 1];
    const name = String(item.use.data.name ?? 'tool');
    if (last?.type === 'steps') last.tools.push(name);
    else out.push({ type: 'steps', id: item.use.id, tools: [name] });
  }
  return out;
}

const STEP_WORDS: Record<string, [one: string, many: string]> = {
  Read: ['read a file', 'read {n} files'],
  Edit: ['edited a file', 'edited {n} files'],
  MultiEdit: ['edited a file', 'edited {n} files'],
  Write: ['wrote a file', 'wrote {n} files'],
  Bash: ['ran a command', 'ran {n} commands'],
  Grep: ['searched the code', 'searched the code {n} times'],
  Glob: ['listed files', 'listed files {n} times'],
  WebFetch: ['read a web page', 'read {n} web pages'],
  WebSearch: ['searched the web', 'searched the web {n} times'],
};

/** "read 4 files, ran 2 commands and 1 more step" for a run of tool calls the summary folded. */
export function describeSteps(tools: string[]): string {
  const counts = new Map<string, number>();
  for (const t of tools) counts.set(t, (counts.get(t) ?? 0) + 1);
  const parts: string[] = [];
  let other = 0;
  for (const [tool, n] of counts) {
    const words = STEP_WORDS[tool];
    if (words) parts.push((n === 1 ? words[0] : words[1]).replace('{n}', String(n)));
    else other += n;
  }
  if (other) parts.push(`${other} other step${other === 1 ? '' : 's'}`);
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] ?? '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function toolSummary(name: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  switch (name) {
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return shortPath(s('file_path'));
    case 'Bash':
      return s('description') ? `${s('description')} — ${s('command').split('\n')[0]}` : s('command').split('\n')[0];
    case 'Grep':
      return `${s('pattern')}${s('path') ? `  in ${shortPath(s('path'))}` : ''}`;
    case 'Glob':
      return s('pattern');
    case 'WebFetch':
      return s('url');
    case 'WebSearch':
      return s('query');
    default:
      return JSON.stringify(input).slice(0, 140);
  }
}
