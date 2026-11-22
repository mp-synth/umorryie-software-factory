import type { Ticket } from '@factory/shared';
import { section } from './plan.ts';

export interface PullRequestText {
  title: string;
  body: string;
}

interface Description {
  what: string;
  why: string;
  overview: string[];
}

type DescriptionPart = keyof Description;

export const CLAUDE_CODE_ATTRIBUTION = '🤖 Generated with [Claude Code](https://claude.com/claude-code)';

const ATTRIBUTION_LINE = /^\s*(🤖\s*)?Generated with \[?Claude Code\]?|^\s*Co-Authored-By/i;
const MIN_TITLE_LENGTH = 8;
const MAX_TITLE_LENGTH = 72;
const MAX_WHAT_SENTENCES = 2;
const MAX_WHY_SENTENCES = 3;
const MIN_OVERVIEW_BULLETS = 2;
const MAX_OVERVIEW_BULLETS = 4;
const MAX_BULLET_LENGTH = 100;
const PART_LABEL = /^\*{0,2}(what|why|overview)\b\*{0,2}(:)?\*{0,2}\s*(.*)$/i;
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

function isShortProse(lines: string[], maxSentences: number): boolean {
  return lines.length > 0 && !lines.some((l) => STRUCTURED_LINE.test(l)) && sentenceCount(lines.join(' ')) <= maxSentences;
}

function overviewBullets(lines: string[]): string[] | null {
  const bullets = lines.map((l) => BULLET.exec(l)?.[1].trim() ?? null);
  if (bullets.length < MIN_OVERVIEW_BULLETS || bullets.length > MAX_OVERVIEW_BULLETS) return null;
  return bullets.every((b) => b && b.length <= MAX_BULLET_LENGTH && !STRUCTURED_LINE.test(b)) ? (bullets as string[]) : null;
}

function parseDescription(text: string): Description | null {
  if (FILE_PATH.test(text)) return null;
  const parts: Record<DescriptionPart, string[]> = { what: [], why: [], overview: [] };
  let current: DescriptionPart | null = null;
  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const label = PART_LABEL.exec(line);
    if (label && (label[2] || !label[3])) {
      current = label[1].toLowerCase() as DescriptionPart;
      if (label[3]) parts[current].push(label[3]);
    } else if (current) {
      parts[current].push(line);
    } else {
      return null;
    }
  }
  const overview = overviewBullets(parts.overview);
  if (!isShortProse(parts.what, MAX_WHAT_SENTENCES) || !isShortProse(parts.why, MAX_WHY_SENTENCES) || !overview) return null;
  return { what: parts.what.join(' '), why: parts.why.join(' '), overview };
}

function renderDescription({ what, why, overview }: Description): string {
  return [
    `**What:** ${what}`,
    `**Why:** ${why}`,
    overview.length ? ['**Overview**', ...overview.map((b) => `- ${b}`)].join('\n') : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function pullRequestText(buildMd: string | null | undefined, ticket: Pick<Ticket, 'title' | 'what' | 'goal'>): PullRequestText {
  const [firstLine = '', ...rest] = (buildMd ? section(buildMd, 'Pull request') ?? '' : '').split('\n');
  const title = stripTitleDecoration(firstLine);
  const description = parseDescription(rest.filter((line) => !ATTRIBUTION_LINE.test(line)).join('\n'));
  return {
    title: isOutcomeTitle(title) ? title : ticket.title,
    body: `${renderDescription(description ?? { what: ticket.what, why: ticket.goal, overview: [] })}\n\n${CLAUDE_CODE_ATTRIBUTION}`,
  };
}
