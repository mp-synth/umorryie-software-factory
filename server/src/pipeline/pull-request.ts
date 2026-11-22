import type { Ticket } from '@factory/shared';
import { section } from './plan.ts';

export interface PullRequestText {
  title: string;
  body: string;
}

interface Description {
  why: string;
  what: string[];
}

type DescriptionPart = keyof Description;

export const CLAUDE_CODE_ATTRIBUTION = '🤖 Generated with [Claude Code](https://claude.com/claude-code)';

const ATTRIBUTION_LINE = /^\s*(🤖\s*)?Generated with \[?Claude Code\]?|^\s*Co-Authored-By/i;
const MIN_TITLE_LENGTH = 8;
const MAX_TITLE_LENGTH = 72;
const MAX_WHY_SENTENCES = 3;
const MAX_WHAT_BULLETS = 4;
const MAX_BULLET_LENGTH = 240;
const HEADING = /^#{2,3}\s+(.+?)\s*:?$/;
const BULLET = /^[-*+]\s+(.+)$/;
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

function isShortProse(lines: string[]): boolean {
  return lines.length > 0 && !lines.some((l) => STRUCTURED_LINE.test(l)) && sentenceCount(lines.join(' ')) <= MAX_WHY_SENTENCES;
}

function bulletList(lines: string[]): string[] | null {
  const bullets = lines.map((l) => BULLET.exec(l)?.[1].trim() ?? null);
  if (bullets.length < 1 || bullets.length > MAX_WHAT_BULLETS) return null;
  return bullets.every((b) => b && b.length <= MAX_BULLET_LENGTH && !STRUCTURED_LINE.test(b)) ? (bullets as string[]) : null;
}

function parseDescription(text: string): Description | null {
  if (FILE_PATH.test(text)) return null;
  const parts: Record<DescriptionPart, string[]> = { why: [], what: [] };
  let current: DescriptionPart | null = null;
  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const heading = HEADING.exec(line)?.[1].toLowerCase();
    if (heading === 'why' || heading === 'what') current = heading;
    else if (heading || !current) return null;
    else parts[current].push(line);
  }
  const what = bulletList(parts.what);
  return isShortProse(parts.why) && what ? { why: parts.why.join(' '), what } : null;
}

function renderDescription({ why, what }: Description): string {
  return `## Why\n\n${why}\n\n## What\n\n${what.map((b) => `- ${b}`).join('\n')}`;
}

export function pullRequestText(buildMd: string | null | undefined, ticket: Pick<Ticket, 'title' | 'what' | 'goal'>): PullRequestText {
  const [firstLine = '', ...rest] = (buildMd ? section(buildMd, 'Pull request') ?? '' : '').split('\n');
  const title = stripTitleDecoration(firstLine);
  const description = parseDescription(rest.filter((line) => !ATTRIBUTION_LINE.test(line)).join('\n'));
  return {
    title: isOutcomeTitle(title) ? title : ticket.title,
    body: `${renderDescription(description ?? { why: ticket.goal, what: [ticket.what] })}\n\n${CLAUDE_CODE_ATTRIBUTION}`,
  };
}
