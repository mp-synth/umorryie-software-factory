import path from 'node:path';
import { git } from '../git.ts';
import { readIfExists, write } from './files.ts';

export interface CursorRule {
  path: string;
  description: string | null;
  globs: string | null;
  alwaysApply: boolean;
  pointsTo: string[];
}

export interface RepoGuidance {
  rootAgentsMdWithoutClaudeMd: boolean;
  cursorRules: CursorRule[];
  nestedAgentsMd: string[];
}

function frontmatterValue(frontmatter: string, key: string): string | null {
  const m = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(frontmatter);
  const v = m?.[1].trim().replace(/^["']|["']$/g, '');
  return v ? v : null;
}

export function parseCursorRule(rulePath: string, content: string): CursorRule {
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(content);
  const frontmatter = fm?.[1] ?? '';
  const body = fm ? content.slice(fm[0].length) : content;
  return {
    path: rulePath,
    description: frontmatterValue(frontmatter, 'description'),
    globs: frontmatterValue(frontmatter, 'globs'),
    alwaysApply: frontmatterValue(frontmatter, 'alwaysApply') === 'true',
    pointsTo: [...body.matchAll(/\(mdc:([^)]+)\)/g)].map((m) => m[1]),
  };
}

export function collectRepoGuidance(tracked: string[], read: (p: string) => string): RepoGuidance {
  const files = new Set(tracked);
  const claudeRuleNames = new Set(
    tracked.filter((p) => p.startsWith('.claude/rules/')).map((p) => path.basename(p).replace(/\.mdc?$/, '')),
  );
  const cursorRules = tracked
    .filter((p) => p.startsWith('.cursor/rules/') && p.endsWith('.mdc'))
    .filter((p) => !claudeRuleNames.has(path.basename(p, '.mdc')))
    .map((p) => parseCursorRule(p, read(p)));
  const nestedAgentsMd = tracked
    .filter((p) => p.endsWith('/AGENTS.md'))
    .filter((p) => !files.has(path.join(path.dirname(p), 'CLAUDE.md')));
  return {
    rootAgentsMdWithoutClaudeMd: files.has('AGENTS.md') && !files.has('CLAUDE.md'),
    cursorRules,
    nestedAgentsMd,
  };
}

export function renderRepoGuidance(g: RepoGuidance, codeRoot: string): string | null {
  if (!g.rootAgentsMdWithoutClaudeMd && !g.cursorRules.length && !g.nestedAgentsMd.length) return null;
  const abs = (p: string) => path.join(codeRoot, p);
  const lines = [
    '# Repo guidance Claude Code does not load by itself',
    '',
    'The repo\'s CLAUDE.md files and `.claude/rules` are already in your context. The files below are not.',
    'They are the same team\'s rules written for other tools: follow them like CLAUDE.md.',
  ];
  if (g.rootAgentsMdWithoutClaudeMd) {
    lines.push('', '## Read first', '', `- ${abs('AGENTS.md')}: the repo's main agent instructions.`);
  }
  const always = g.cursorRules.filter((r) => r.alwaysApply);
  const scoped = g.cursorRules.filter((r) => !r.alwaysApply);
  const ruleLine = (r: CursorRule) =>
    [
      `- ${abs(r.path)}`,
      r.description ? `: ${r.description}` : '',
      r.globs ? ` (applies to \`${r.globs}\`)` : '',
      r.pointsTo.length ? `; the rule is in ${r.pointsTo.map(abs).join(', ')}` : '',
    ].join('');
  if (always.length) lines.push('', '## Always apply', '', ...always.map(ruleLine));
  if (scoped.length) {
    lines.push('', '## Read when your work matches the description or the files you change match the globs', '', ...scoped.map(ruleLine));
  }
  if (g.nestedAgentsMd.length) {
    lines.push(
      '',
      '## Package instructions',
      '',
      'Read the one nearest to each file you change before you change it.',
      '',
      ...g.nestedAgentsMd.map((p) => `- ${abs(p)}`),
    );
  }
  return lines.join('\n');
}

export async function writeRepoGuidance(codeRoot: string, dir: string): Promise<string | null> {
  const r = await git(codeRoot, ['ls-files', '--', 'AGENTS.md', 'CLAUDE.md', '*/AGENTS.md', '*/CLAUDE.md', '.cursor/rules/*.mdc', '.claude/rules/*']);
  if (r.code !== 0) return null;
  const tracked = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const guidance = collectRepoGuidance(tracked, (p) => readIfExists(path.join(codeRoot, p)) ?? '');
  const md = renderRepoGuidance(guidance, codeRoot);
  return md ? write(path.join(dir, 'repo-guidance.md'), md) : null;
}
