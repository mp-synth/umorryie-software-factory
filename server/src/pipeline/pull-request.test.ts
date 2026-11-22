import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLAUDE_CODE_ATTRIBUTION, pullRequestText } from './pull-request.ts';

const withAttribution = (description: string) => `${description}\n\n${CLAUDE_CODE_ATTRIBUTION}`;

const ticket = {
  title: 'Restore charge amounts when an unlimited add-on is removed',
  what: 'Removing an unlimited add-on puts the template charge amount back on the Lago subscription.',
  goal: 'Customers stop being billed at 0 after the add-on is gone.',
};

const buildMd = (pr: string) => `STATUS: READY\n\n## Summary\n- done\n\n## Pull request\n${pr}\n\n## Changes\n- service/billing/sync.py\n`;

const why =
  'Removing an unlimited add-on left the feature billed at 0. The charge sync compared the payment plan with the Lago plan template, which matches again once the add-on is gone, so the `"0"` override on the Lago subscription was never reverted.';
const what = [
  "The charge sync compares the payment plan's `credits_per_unit` with the charge amounts on the Lago subscription and overrides every charge that differs, so removing an add-on restores the template amount.",
  'Overrides apply to the subscription generation being synced (active or pending).',
];

const list = (items: string[]) => items.map((b) => `- ${b}`).join('\n');
const written = `### Why\n${why}\n\n### What\n${list(what)}`;
const rendered = `## Why\n\n${why}\n\n## What\n\n${list(what)}`;
const fallbackBody = withAttribution(`## Why\n\n${ticket.goal}\n\n## What\n\n- ${ticket.what}`);

test('renders the why and what the executor wrote as headings', () => {
  const pr = pullRequestText(buildMd(`Restore charge amounts when an add-on is removed\n\n${written}`), ticket);
  assert.equal(pr.title, 'Restore charge amounts when an add-on is removed');
  assert.equal(pr.body, withAttribution(rendered));
});

test('accepts heading and bullet variations', () => {
  const loose = `### Why:\n${why}\n\n### What\n* ${what[0]}\n+ ${what[1]}`;
  assert.equal(pullRequestText(buildMd(`Restore charge amounts when an add-on is removed\n\n${loose}`), ticket).body, withAttribution(rendered));
});

test('keeps exactly one Claude Code attribution line, even when the executor already wrote it', () => {
  const pr = pullRequestText(buildMd(`Restore charge amounts when an add-on is removed\n\n${written}\n\n${CLAUDE_CODE_ATTRIBUTION}`), ticket);
  assert.equal(pr.body, withAttribution(rendered));
});

test('strips heading and "Title:" decoration from the title', () => {
  const pr = pullRequestText(buildMd(`### Title: "Restore charge amounts when an add-on is removed"\n\n${written}`), ticket);
  assert.equal(pr.title, 'Restore charge amounts when an add-on is removed');
});

test('falls back to the ticket when the description breaks the rules', () => {
  const whyPart = '### Why\nCharges stayed at 0.';
  const whatPart = '### What\n- Charges are restored';
  const cases = [
    'Removing an add-on now restores the charge. Customers are billed again.',
    `Intro line.\n\n${whyPart}\n\n${whatPart}`,
    whatPart,
    whyPart,
    `${whyPart}\n\n### What\nCharges are restored.`,
    `${whyPart}\n\n### What\n- One\n- Two\n- Three\n- Four\n- Five`,
    `${whyPart}\n\n### What\n- ${'x'.repeat(241)}`,
    `${whyPart}\n\n### What\n1. One\n2. Two`,
    `${whyPart}\n\n### What\n- [ ] One`,
    `${whyPart}\n\n### What\n- Adds restore_charges in service/billing/sync.py`,
    `### Why\nOne. Two. Three. Four.\n\n${whatPart}`,
    `${whyPart}\n\n${whatPart}\n\n### Existing subscriptions\nThey fix themselves on their next sync.`,
  ];
  for (const pr of cases) assert.equal(pullRequestText(buildMd(`Restore charges\n\n${pr}`), ticket).body, fallbackBody, pr);
});

test('falls back to the ticket title for numbered, overlong or missing titles', () => {
  assert.equal(pullRequestText(buildMd(`[01] Restore charge amounts\n\n${written}`), ticket).title, ticket.title);
  assert.equal(pullRequestText(buildMd(`${'x'.repeat(80)}\n\n${written}`), ticket).title, ticket.title);
  assert.equal(pullRequestText('STATUS: READY\n\n## Summary\n- done', ticket).title, ticket.title);
  assert.equal(pullRequestText(null, ticket).body, fallbackBody);
});
