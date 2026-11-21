import type { Ticket } from '@factory/shared';
import { section } from './plan.ts';

export interface PullRequestText {
  title: string;
  body: string;
}

export const CLAUDE_CODE_ATTRIBUTION = '🤖 Generated with [Claude Code](https://claude.com/claude-code)';

const ATTRIBUTION_LINE = /^\s*(🤖\s*)?Generated with \[?Claude Code\]?|^\s*Co-Authored-By/i;
const MIN_TITLE_LENGTH = 8;
const MAX_TITLE_LENGTH = 72;
const MIN_SENTENCES = 2;
const MAX_SENTENCES = 4;
const STRUCTURED_LINE = /^\s*(#|[-*+]\s|\d+[.)]\s|\||>|```|\[[ x]\])/i;
const FILE_PATH = /(^|[\s(`])[\w.-]+\/[\w./-]+|\b[\w-]+\.(ts|tsx|js|jsx|py|go|rs|rb|java|kt|sql|json|ya?ml|md)\b/;

function sentenceCount(text: string): number {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim()).length;
}

function stripTitleDecoration(line: string): string {
  return line
    .replace(/^\s*#+\s*/, '')
    .replace(/^title:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

function isOutcomeTitle(title: string): boolean {
  return title.length >= MIN_TITLE_LENGTH && title.length <= MAX_TITLE_LENGTH && !/^[[\d]/.test(title) && !/[.:]$/.test(title);
}

function isHighLevelDescription(body: string): boolean {
  const lines = body.split('\n').filter((l) => l.trim());
  if (!lines.length || lines.some((l) => STRUCTURED_LINE.test(l)) || FILE_PATH.test(body)) return false;
  const sentences = sentenceCount(lines.join(' '));
  return sentences >= MIN_SENTENCES && sentences <= MAX_SENTENCES;
}

export function pullRequestText(buildMd: string | null | undefined, ticket: Pick<Ticket, 'title' | 'what' | 'goal'>): PullRequestText {
  const [firstLine = '', ...rest] = (buildMd ? section(buildMd, 'Pull request') ?? '' : '').split('\n');
  const title = stripTitleDecoration(firstLine);
  const description = rest.filter((line) => !ATTRIBUTION_LINE.test(line)).join('\n').trim();
  return {
    title: isOutcomeTitle(title) ? title : ticket.title,
    body: `${isHighLevelDescription(description) ? description : `${ticket.what} ${ticket.goal}`.trim()}\n\n${CLAUDE_CODE_ATTRIBUTION}`,
  };
}
