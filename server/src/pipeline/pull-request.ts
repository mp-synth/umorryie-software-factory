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

function parsePullRequest(md: string | null | undefined): { title: string | null; description: Description | null } {
  const [firstLine = '', ...rest] = (md ? section(md, 'Pull request') ?? '' : '').split('\n');
  const title = stripTitleDecoration(firstLine);
  return {
    title: isOutcomeTitle(title) ? title : null,
    description: parseDescription(rest.filter((line) => !ATTRIBUTION_LINE.test(line)).join('\n')),
  };
}

function renderBody(description: Description): string {
  return `${renderDescription(description)}\n\n${CLAUDE_CODE_ATTRIBUTION}`;
}

export function pullRequestText(buildMd: string | null | undefined, ticket: Pick<Ticket, 'title' | 'what' | 'goal'>): PullRequestText {
  const { title, description } = parsePullRequest(buildMd);
  return { title: title ?? ticket.title, body: renderBody(description ?? { why: ticket.goal, what: [ticket.what] }) };
}

/** The PR text a fixer rewrote for the PR as it stands after its commits, or null when it wrote none that is valid. */
export function revisedPullRequestText(fixMd: string | null | undefined): PullRequestText | null {
  const { title, description } = parsePullRequest(fixMd);
  return title && description ? { title, body: renderBody(description) } : null;
}

export function isSamePullRequestText(a: PullRequestText, b: PullRequestText): boolean {
  return a.title.trim() === b.title.trim() && a.body.trim() === b.body.trim();
}

/** The PR's current text in the fix.md form, so a fixer can copy what still holds. */
export function asPullRequestSection(text: PullRequestText): string {
  const body = text.body.replace(/^#{2,}\s+/gm, '### ').split('\n').filter((line) => !ATTRIBUTION_LINE.test(line)).join('\n').trim();
  return `## Pull request\n${text.title}\n\n${body}\n`;
}
