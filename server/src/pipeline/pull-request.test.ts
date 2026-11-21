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

test('uses the title and description the executor wrote', () => {
  const pr = pullRequestText(
    buildMd('Clear completed todos with one command\n\nUsers can now remove every completed todo at once. This keeps long lists readable without editing the file by hand.'),
    ticket,
  );
  assert.equal(pr.title, 'Clear completed todos with one command');
  assert.equal(pr.body, withAttribution('Users can now remove every completed todo at once. This keeps long lists readable without editing the file by hand.'));
});

test('keeps exactly one Claude Code attribution line, even when the executor already wrote it', () => {
  const pr = pullRequestText(
    buildMd(`Clear completed todos with one command\n\nUsers can remove every completed todo at once. Long lists stay readable.\n\n${CLAUDE_CODE_ATTRIBUTION}`),
    ticket,
  );
  assert.equal(pr.body, withAttribution('Users can remove every completed todo at once. Long lists stay readable.'));
});

test('strips heading and "Title:" decoration from the title', () => {
  const pr = pullRequestText(buildMd('### Title: "Clear completed todos with one command"\n\nOne. Two.'), ticket);
  assert.equal(pr.title, 'Clear completed todos with one command');
});

test('falls back to the ticket when the description breaks the rules', () => {
  const fallbackBody = withAttribution(`${ticket.what} ${ticket.goal}`);
  const cases = [
    'Clear done todos\n\n## Summary\nSomething. Else.',
    'Clear done todos\n\n- adds clearDone\n- adds tests',
    'Clear done todos\n\nAdds clearDone in src/todos.ts. Wires it into the CLI.',
    'Clear done todos\n\nOne sentence only.',
    'Clear done todos\n\nOne. Two. Three. Four. Five.',
  ];
  for (const md of cases) assert.equal(pullRequestText(buildMd(md), ticket).body, fallbackBody, md);
});

test('falls back to the ticket title for numbered, overlong or missing titles', () => {
  assert.equal(pullRequestText(buildMd('[01] Clear completed todos\n\nOne. Two.'), ticket).title, ticket.title);
  assert.equal(pullRequestText(buildMd(`${'x'.repeat(80)}\n\nOne. Two.`), ticket).title, ticket.title);
  assert.equal(pullRequestText('STATUS: READY\n\n## Summary\n- done', ticket).title, ticket.title);
  assert.equal(pullRequestText(null, ticket).body, withAttribution(`${ticket.what} ${ticket.goal}`));
});
