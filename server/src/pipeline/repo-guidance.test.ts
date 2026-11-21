import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectRepoGuidance, parseCursorRule, renderRepoGuidance } from './repo-guidance.ts';

const files: Record<string, string> = {
  '.cursor/rules/imports.mdc': '---\ndescription: Rules about imports\nalwaysApply: false\n---\n\n[imports.md](mdc:docs/guidelines/imports.md)\n',
  '.cursor/rules/copywriting.mdc': '---\ndescription: "Copy tone"\nglobs: apps/**/*.tsx\nalwaysApply: true\n---\nWrite plainly.\n',
  '.cursor/rules/testing_guidelines.mdc': '---\ndescription: mirrored\n---\n',
  '.claude/rules/testing_guidelines.md': '# Testing',
};

test('parses a Cursor rule frontmatter and the docs it points to', () => {
  assert.deepEqual(parseCursorRule('.cursor/rules/imports.mdc', files['.cursor/rules/imports.mdc']), {
    path: '.cursor/rules/imports.mdc',
    description: 'Rules about imports',
    globs: null,
    alwaysApply: false,
    pointsTo: ['docs/guidelines/imports.md'],
  });
});

test('skips Cursor rules mirrored in .claude/rules and AGENTS.md files Claude Code already reaches', () => {
  const tracked = [
    ...Object.keys(files),
    'CLAUDE.md',
    'AGENTS.md',
    'packages/storybook/AGENTS.md',
    'apps/studio/AGENTS.md',
    'apps/studio/CLAUDE.md',
  ];
  const g = collectRepoGuidance(tracked, (p) => files[p] ?? '');
  assert.equal(g.rootAgentsMdWithoutClaudeMd, false);
  assert.deepEqual(g.cursorRules.map((r) => r.path).sort(), ['.cursor/rules/copywriting.mdc', '.cursor/rules/imports.mdc']);
  assert.deepEqual(g.nestedAgentsMd, ['packages/storybook/AGENTS.md']);
});

test('renders absolute paths and nothing at all for a repo Claude Code fully covers', () => {
  const g = collectRepoGuidance(Object.keys(files), (p) => files[p] ?? '');
  const md = renderRepoGuidance(g, '/repo')!;
  assert.match(md, /## Always apply\n\n- \/repo\/\.cursor\/rules\/copywriting\.mdc: Copy tone \(applies to `apps\/\*\*\/\*\.tsx`\)/);
  assert.match(md, /imports\.mdc: Rules about imports; the rule is in \/repo\/docs\/guidelines\/imports\.md/);
  assert.equal(renderRepoGuidance(collectRepoGuidance(['CLAUDE.md', '.claude/rules/a.md'], () => ''), '/repo'), null);
});

test('a root AGENTS.md without CLAUDE.md is read first', () => {
  const md = renderRepoGuidance(collectRepoGuidance(['AGENTS.md'], () => ''), '/repo')!;
  assert.match(md, /## Read first\n\n- \/repo\/AGENTS\.md/);
});
