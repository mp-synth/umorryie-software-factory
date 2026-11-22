import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLAUDE_CODE_ATTRIBUTION, pullRequestText } from './pull-request.ts';

const withAttribution = (description: string) => `${description}\n\n${CLAUDE_CODE_ATTRIBUTION}`;

const ticket = {
  title: 'Add todo clear --done to delete completed todos',
  what: 'Users can delete every completed todo with one command.',
  goal: 'Long lists stay readable without editing the todo file by hand.',
};

const buildMd = (pr: string) => `STATUS: READY\n\n## Summary\n- done\n\n## Pull request\n${pr}\n\n## Changes\n- src/todos.ts\n`;

const description = [
  '**What:** Users can remove every completed todo with one command.',
  '**Why:** Long lists get hard to read, and today the only way out is editing the file by hand.',
  '**Overview**\n- New `clear --done` command deletes completed todos\n- Open todos are never touched',
].join('\n\n');

const fallbackBody = withAttribution(`**What:** ${ticket.what}\n\n**Why:** ${ticket.goal}`);

test('uses the title and description the executor wrote', () => {
  const pr = pullRequestText(buildMd(`Clear completed todos with one command\n\n${description}`), ticket);
  assert.equal(pr.title, 'Clear completed todos with one command');
  assert.equal(pr.body, withAttribution(description));
});

test('normalizes label and bullet variations to one layout', () => {
  const loose = [
    'What: Users can remove every completed todo with one command.',
    '**Why**:',
    'Long lists get hard to read, and today the only way out is editing the file by hand.',
    'Overview:',
    '* New `clear --done` command deletes completed todos',
    '+ Open todos are never touched',
  ].join('\n');
  assert.equal(pullRequestText(buildMd(`Clear completed todos with one command\n\n${loose}`), ticket).body, withAttribution(description));
});

test('keeps exactly one Claude Code attribution line, even when the executor already wrote it', () => {
  const pr = pullRequestText(buildMd(`Clear completed todos with one command\n\n${description}\n\n${CLAUDE_CODE_ATTRIBUTION}`), ticket);
  assert.equal(pr.body, withAttribution(description));
});

test('strips heading and "Title:" decoration from the title', () => {
  const pr = pullRequestText(buildMd(`### Title: "Clear completed todos with one command"\n\n${description}`), ticket);
  assert.equal(pr.title, 'Clear completed todos with one command');
});

test('falls back to the ticket when the description breaks the rules', () => {
  const what = '**What:** Users can remove completed todos.';
  const why = '**Why:** Long lists get hard to read.';
  const cases = [
    'Users can now remove every completed todo at once. This keeps long lists readable.',
    `## Summary\n${what}\n\n${why}\n\n**Overview**\n- One\n- Two`,
    `Intro line.\n\n${what}\n\n${why}\n\n**Overview**\n- One\n- Two`,
    `${what}\n\n**Overview**\n- One\n- Two`,
    `${what}\n\n${why}`,
    `${what}\n\n${why}\n\n**Overview**\n- Only one bullet`,
    `${what}\n\n${why}\n\n**Overview**\n- One\n- Two\n- Three\n- Four\n- Five`,
    `${what}\n\n${why}\n\n**Overview**\n- One\n- ${'x'.repeat(101)}`,
    `${what}\n\n${why}\n\n**Overview**\n1. One\n2. Two`,
    `${what}\n\n${why}\n\n**Overview**\n- [ ] One\n- [x] Two`,
    `${what}\n\n${why}\n\n**Overview**\n- Adds clearDone in src/todos.ts\n- Wires it into the CLI`,
    `**What:** One. Two. Three.\n\n${why}\n\n**Overview**\n- One\n- Two`,
    `${what}\n\n**Why:** One. Two. Three. Four.\n\n**Overview**\n- One\n- Two`,
  ];
  for (const pr of cases) assert.equal(pullRequestText(buildMd(`Clear done todos\n\n${pr}`), ticket).body, fallbackBody, pr);
});

test('falls back to the ticket title for numbered, overlong or missing titles', () => {
  assert.equal(pullRequestText(buildMd(`[01] Clear completed todos\n\n${description}`), ticket).title, ticket.title);
  assert.equal(pullRequestText(buildMd(`${'x'.repeat(80)}\n\n${description}`), ticket).title, ticket.title);
  assert.equal(pullRequestText('STATUS: READY\n\n## Summary\n- done', ticket).title, ticket.title);
  assert.equal(pullRequestText(null, ticket).body, fallbackBody);
});
