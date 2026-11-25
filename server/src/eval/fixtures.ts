import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Ticket } from '@factory/shared';
import * as gitx from '../git.ts';
import { gateBody } from '../pipeline/gate-output.ts';
import { renderTicket, write } from '../pipeline/files.ts';
import { BASE_FILES, CHECKS_COMMAND } from './project.ts';

export type EvalRole = 'review' | 'verify';
export type Expected = 'APPROVE' | 'CHANGES' | 'BLOCK';

export interface EvalCase {
  name: string;
  role: EvalRole;
  expected: Expected;
  defectKind: string | null;
  defectFile: string | null;
  markers: string[];
}

export const OUTPUT_FILE: Record<EvalRole, string> = { review: 'review.md', verify: 'verify.md' };

export interface Fixture {
  dir: string;
  worktree: string;
  runDir: string;
  branch: string;
  base: string;
  start: string | null;
  ticket: Ticket;
  inputs: string[];
  output: string;
}

type Files = Record<string, string | null>;

interface Commit {
  message: string;
  files: Files;
}

interface TicketSpec {
  key: string;
  title: string;
  what: string;
  goal: string;
  outcome: string;
  guidance: string[];
  acceptance: string[];
}

interface CaseSpec extends EvalCase {
  ticket: TicketSpec;
  commits: Commit[];
  fixCommits: Commit[];
  build: string | null;
  review: string | null;
  fix: string | null;
}

const BASE = 'main';
export const INITIATIVE_TITLE = 'Tally shop features';
const GUIDANCE = ['Follow AGENTS.md.', 'Keep the change inside the files the ticket needs.'];

const ticketRecord = (spec: TicketSpec): Ticket => ({
  id: 'eval-ticket',
  initiativeId: 'eval-initiative',
  key: spec.key,
  seq: 1,
  wave: 1,
  title: spec.title,
  what: spec.what,
  goal: spec.goal,
  outcome: spec.outcome,
  guidance: spec.guidance,
  acceptance: spec.acceptance,
  dependsOn: [],
  needs: [],
  size: 'S',
  status: 'in_review',
  round: 1,
  branch: null,
  baseRef: BASE,
  worktreePath: null,
  prNumber: null,
  prUrl: null,
  prState: null,
  prHeadRef: null,
  prStack: null,
  lastVerdict: null,
  gateStatus: 'pass',
  blockedReason: null,
  prSweepClaimedAt: null,
  prSweepFingerprint: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const CHECKS_OUTPUT = 'no syntax errors';

const checksMd = (cwd: string, logPath: string) =>
  `GATE: PASS\n\n${gateBody({ command: CHECKS_COMMAND, code: 0, timedOut: false, seconds: 1, cwd, output: CHECKS_OUTPUT, logPath })}`;

function buildMd(t: TicketSpec, o: { bullets: string[]; changes: string[]; evidence: string[]; notes: string; why: string; what: string[] }): string {
  return [
    'STATUS: READY',
    '',
    `# Build: ${t.title}`,
    '',
    '## Summary',
    ...o.bullets.map((b) => `- ${b}`),
    '',
    '## Changes',
    ...o.changes.map((c) => `- ${c}`),
    '',
    '## Acceptance checks',
    ...t.acceptance.map((a, n) => `${n + 1}. [x] ${a}: ${o.evidence[n]}`),
    '',
    '## Validation',
    `- ${CHECKS_COMMAND}: passed`,
    '',
    '## Notes for the reviewer',
    o.notes,
    '',
    '## Pull request',
    t.title,
    '',
    '### Why',
    o.why,
    '',
    '### What',
    ...o.what.map((l) => `- ${l}`),
  ].join('\n');
}

const REVIEW_ACCEPTANCE = [
  '| unitPrice returns the base price below 10 units | met | src/pricing.js:8 |',
  '| unitPrice returns 90% of the base price from 10 units | unmet | R1.1 |',
];

const R1_1 = [
  '### R1.1 [major] src/pricing.js:5 — the bulk price starts at 11 units, the ticket says 10',
  '- Failure scenario: unitPrice(1000, 10) returns 1000; the ticket requires 900.',
  '- Evidence: line 5 compares with >, so a quantity equal to BULK_THRESHOLD never gets the bulk price.',
  '- Suggested fix: compare with >= and add a test at quantity 10.',
];

const R1_2 = [
  '### R1.2 [major] src/pricing.js:4 — unitPrice accepts quantities below 1 and fractions',
  '- Failure scenario: unitPrice(1000, -5) returns 1000 instead of rejecting the input.',
  '- Evidence: nothing between line 4 and the return checks the quantity.',
  '- Suggested fix: throw a RangeError unless quantity is an integer of at least 1, and test it.',
];

const reviewMd = (findings: string[][]) =>
  [
    'VERDICT: CHANGES',
    '',
    '## Summary',
    '- Read the diff and traced unitPrice at the boundary; the findings below are confirmed.',
    '',
    '## Acceptance',
    '| Check | Result | Evidence |',
    '| --- | --- | --- |',
    ...REVIEW_ACCEPTANCE,
    '',
    '## Findings',
    ...findings.flatMap((f) => [...f, '']),
  ].join('\n');

function fixMd(o: { triage: string[]; changes: string[]; replies: string[] }): string {
  return [
    'FIX: APPLIED',
    '',
    '## Summary',
    '- Triaged every review item against the code and committed the fixes locally.',
    '',
    '## Triage',
    '| Item | Source | Verdict | Evidence |',
    '|---|---|---|---|',
    ...o.triage,
    '',
    '## Changes',
    ...o.changes.map((c) => `- ${c}`),
    '',
    '## Validation',
    `- ${CHECKS_COMMAND}: passed`,
    '',
    '## Replies',
    ...(o.replies.length ? o.replies : ['None.']),
  ].join('\n');
}

const TRIAGE_R1_1 = (evidence: string) => `| R1.1 | review | VALID | ${evidence} |`;

const FIX_TICKET: TicketSpec = {
  key: 'bulk-pricing',
  title: 'Add bulk pricing tier',
  what: 'unitPrice(baseCents, quantity) returns the base price for fewer than 10 units and 10% less, rounded to whole cents, from 10 units up.',
  goal: 'Orders of ten or more units pay the bulk price.',
  outcome: 'unitPrice(1000, 9) is 1000 and unitPrice(1000, 10) is 900.',
  guidance: GUIDANCE,
  acceptance: ['unitPrice returns the base price below 10 units', 'unitPrice returns 90% of the base price from 10 units'],
};

const PRICING_BUGGY = `export const BULK_THRESHOLD = 10;
export const BULK_RATE = 0.1;

export function unitPrice(baseCents, quantity) {
  if (quantity > BULK_THRESHOLD) {
    return Math.round(baseCents * (1 - BULK_RATE));
  }
  return baseCents;
}
`;

const PRICING_FIXED = PRICING_BUGGY.replace('quantity > BULK_THRESHOLD', 'quantity >= BULK_THRESHOLD');

const PRICING_TEST_HEAD = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unitPrice } from '../src/pricing.js';
`;

const PRICING_TEST_BODY = `
test('single units pay the base price', () => {
  assert.equal(unitPrice(1000, 1), 1000);
});

test('large orders get the bulk price', () => {
  assert.equal(unitPrice(1000, 20), 900);
});
`;

const PRICING_TEST_PINNED = `
test('ten units pay the base price', () => {
  assert.equal(unitPrice(1000, 10), 1000);
});
`;

const BOUNDARY_TEST = `
test('the tenth unit triggers the bulk price', () => {
  assert.equal(unitPrice(1000, 10), 900);
  assert.equal(unitPrice(1000, 9), 1000);
});
`;

const preFix = (pinned: boolean): Commit[] => [
  {
    message: 'Add bulk pricing tier',
    files: {
      'src/pricing.js': PRICING_BUGGY,
      'test/pricing.test.js': PRICING_TEST_HEAD + PRICING_TEST_BODY + (pinned ? PRICING_TEST_PINNED : ''),
    },
  },
];

const FIX_COMMIT_MESSAGE = 'Start the bulk price at the threshold';
const FIX_SHA = '{{fix0}}';

const verifyCase = (
  name: string,
  expected: Expected,
  defectKind: string | null,
  defectFile: string | null,
  markers: string[],
  o: { pinned?: boolean; findings: string[][]; fixCommits: Commit[]; fix: string },
): CaseSpec => ({
  name,
  role: 'verify',
  expected,
  defectKind,
  defectFile,
  markers,
  ticket: FIX_TICKET,
  commits: preFix(!!o.pinned),
  fixCommits: o.fixCommits,
  build: null,
  review: reviewMd(o.findings),
  fix: o.fix,
});

const fixedBoundaryFiles = (testBody: string, head = PRICING_TEST_HEAD): Files => ({
  'src/pricing.js': PRICING_FIXED,
  'test/pricing.test.js': head + PRICING_TEST_BODY + testBody,
});

const STORE_SORTED = BASE_FILES['src/store.js'].replace(
  'return [...rows.values()].map((row) => ({ ...row }));',
  'return [...rows.keys()].sort().map((key) => ({ ...rows.get(key) }));',
);

const reviewCase = (
  name: string,
  expected: Expected,
  defectKind: string | null,
  defectFile: string | null,
  markers: string[],
  ticket: TicketSpec,
  commits: Commit[],
  build: Parameters<typeof buildMd>[1],
): CaseSpec => ({
  name,
  role: 'review',
  expected,
  defectKind,
  defectFile,
  markers,
  ticket,
  commits,
  fixCommits: [],
  build: buildMd(ticket, build),
  review: null,
  fix: null,
});

const TEST_IMPORTS = (names: string, from: string) => `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ${names} } from '${from}';
`;

const SPECS: CaseSpec[] = [
  reviewCase(
    'review-clean-bulk-pricing',
    'APPROVE',
    null,
    null,
    [],
    {
      key: 'bulk-pricing',
      title: 'Add bulk pricing tier',
      what: 'unitPrice(baseCents, quantity) returns the base price for fewer than 10 units and 10% less, rounded to whole cents, from 10 units up.',
      goal: 'Orders of ten or more units pay the bulk price.',
      outcome: 'unitPrice(1000, 9) is 1000 and unitPrice(1000, 10) is 900; invalid quantities throw a RangeError.',
      guidance: GUIDANCE,
      acceptance: ['unitPrice returns the base price below 10 units', 'unitPrice returns 90% of the base price, rounded, from 10 units', 'A quantity below 1 or not an integer throws a RangeError'],
    },
    [
      {
        message: 'Add bulk pricing tier',
        files: {
          'src/pricing.js': `export const BULK_THRESHOLD = 10;
export const BULK_RATE = 0.1;

export function unitPrice(baseCents, quantity) {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError('quantity must be a positive integer');
  }
  if (quantity >= BULK_THRESHOLD) {
    return Math.round(baseCents * (1 - BULK_RATE));
  }
  return baseCents;
}
`,
          'test/pricing.test.js': `${TEST_IMPORTS('unitPrice', '../src/pricing.js')}
test('fewer than ten units pay the base price', () => {
  assert.equal(unitPrice(1000, 1), 1000);
  assert.equal(unitPrice(1000, 9), 1000);
});

test('ten units or more pay the bulk price', () => {
  assert.equal(unitPrice(1000, 10), 900);
  assert.equal(unitPrice(1000, 11), 900);
});

test('the bulk price is rounded to whole cents', () => {
  assert.equal(unitPrice(999, 10), 899);
});

test('unitPrice rejects quantities that are not positive integers', () => {
  assert.throws(() => unitPrice(1000, 0), RangeError);
  assert.throws(() => unitPrice(1000, 1.5), RangeError);
});
`,
        },
      },
    ],
    {
      bullets: ['unitPrice gives 10% off per unit from 10 units, rounded to whole cents', 'Quantities below 1 or fractional throw a RangeError'],
      changes: ['src/pricing.js: unitPrice with the threshold and rate constants', 'test/pricing.test.js: below, at and above the threshold, rounding and invalid quantities'],
      evidence: ['test/pricing.test.js covers 1 and 9 units', 'test/pricing.test.js covers 10 and 11 units and rounding', 'test/pricing.test.js covers 0 and 1.5'],
      notes: 'None.',
      why: 'Bulk buyers were paying the full unit price.',
      what: ['Orders of ten or more units get the bulk price', 'Quantities that are not positive integers are rejected'],
    },
  ),
  reviewCase(
    'review-free-shipping-boundary',
    'CHANGES',
    'off-by-one',
    'src/shipping.js',
    ['qualifiesForFreeShipping', 'FREE_SHIPPING_CENTS', 'off-by-one', '>='],
    {
      key: 'free-shipping',
      title: 'Add free shipping threshold',
      what: 'qualifiesForFreeShipping(totalCents) is true when an order total is 5000 cents or more.',
      goal: 'Orders of 50.00 or more ship for free.',
      outcome: 'qualifiesForFreeShipping(5000) is true and qualifiesForFreeShipping(4999) is false.',
      guidance: GUIDANCE,
      acceptance: ['An order of exactly 5000 cents qualifies', 'An order of 4999 cents does not qualify'],
    },
    [
      {
        message: 'Add free shipping threshold',
        files: {
          'src/shipping.js': `export const FREE_SHIPPING_CENTS = 5000;

export function qualifiesForFreeShipping(totalCents) {
  return totalCents > FREE_SHIPPING_CENTS;
}
`,
          'test/shipping.test.js': `${TEST_IMPORTS('qualifiesForFreeShipping', '../src/shipping.js')}
test('small orders do not qualify', () => {
  assert.equal(qualifiesForFreeShipping(4999), false);
});

test('large orders qualify', () => {
  assert.equal(qualifiesForFreeShipping(10000), true);
});
`,
        },
      },
    ],
    {
      bullets: ['qualifiesForFreeShipping compares the total with a 5000 cent threshold'],
      changes: ['src/shipping.js: the threshold constant and the predicate', 'test/shipping.test.js: a small and a large order'],
      evidence: ['The predicate compares against FREE_SHIPPING_CENTS', 'test/shipping.test.js small orders'],
      notes: 'None.',
      why: 'Shoppers asked for a free shipping threshold.',
      what: ['Free shipping applies from a 50.00 order total', 'Tests a small and a large order'],
    },
  ),
  reviewCase(
    'review-invite-missing-await',
    'CHANGES',
    'missing-await',
    'src/invites.js',
    ['store.save', 'await'],
    {
      key: 'create-invite',
      title: 'Add createInvite',
      what: 'createInvite(store, email) stores a pending invite under the email and returns the email; inviting the same email twice throws.',
      goal: 'Admins can invite a person once.',
      outcome: 'After createInvite(store, "a@b.co") the store holds a pending invite and a second call throws "already invited".',
      guidance: GUIDANCE,
      acceptance: ['createInvite stores a pending invite', 'Inviting the same email twice throws'],
    },
    [
      {
        message: 'Add createInvite',
        files: {
          'src/invites.js': `export async function createInvite(store, email) {
  const existing = await store.get(email);
  if (existing) {
    throw new Error('already invited');
  }
  store.save(email, { email, status: 'pending' });
  return email;
}
`,
          'test/invites.test.js': `${TEST_IMPORTS('createInvite', '../src/invites.js')}import { createStore } from '../src/store.js';

test('createInvite stores a pending invite', async () => {
  const store = createStore();
  await createInvite(store, 'a@b.co');
  assert.deepEqual(await store.get('a@b.co'), { email: 'a@b.co', status: 'pending' });
});

test('inviting the same email twice throws', async () => {
  const store = createStore();
  await createInvite(store, 'a@b.co');
  await assert.rejects(() => createInvite(store, 'a@b.co'), { message: 'already invited' });
});
`,
        },
      },
    ],
    {
      bullets: ['createInvite checks for an existing invite, then stores a pending one'],
      changes: ['src/invites.js: createInvite', 'test/invites.test.js: stores a pending invite, rejects a duplicate'],
      evidence: ['test/invites.test.js first test', 'test/invites.test.js second test'],
      notes: 'None.',
      why: 'Invites were created by hand in the store.',
      what: ['Admins can invite an email address', 'Inviting an email that was already invited is rejected'],
    },
  ),
  reviewCase(
    'review-slugify-weakened-test',
    'CHANGES',
    'weakened-test',
    'test/text.test.js',
    ['assert.match', 'hello-world', 'weaken', 'loosen'],
    {
      key: 'slugify-digits',
      title: 'Keep digits in slugify',
      what: 'slugify keeps digits, so "Release 2024" becomes "release-2024".',
      goal: 'Slugs for numbered titles stay unique.',
      outcome: 'slugify("Release 2024") is "release-2024" and existing slugs are unchanged.',
      guidance: GUIDANCE,
      acceptance: ['slugify("Release 2024") returns "release-2024"', 'Existing slugify behaviour is unchanged'],
    },
    [
      {
        message: 'Keep digits in slugify',
        files: {
          'src/text.js': `export function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
`,
          'test/text.test.js': `${TEST_IMPORTS('slugify', '../src/text.js')}
test('slugify lowercases and joins words', () => {
  assert.match(slugify('  Hello, World!  '), /hello-world/);
});

test('slugify keeps digits', () => {
  assert.equal(slugify('Release 2024'), 'release-2024');
});
`,
        },
      },
    ],
    {
      bullets: ['slugify now accepts digits in slugs', 'Added a test for numbered titles'],
      changes: ['src/text.js: slugify pattern allows 0-9', 'test/text.test.js: digits test'],
      evidence: ['test/text.test.js digits test', 'test/text.test.js existing slugify test'],
      notes: 'None.',
      why: 'Titles like "Release 2024" lost their number.',
      what: ['Slugs keep the digits of numbered titles', 'Adds a test for numbered titles'],
    },
  ),
  reviewCase(
    'review-delete-handler-without-authz',
    'CHANGES',
    'missing-authz',
    'src/handlers.js',
    ['deleteItem', 'requireRole', 'authoriz', '403'],
    {
      key: 'delete-item',
      title: 'Add deleteItem handler',
      what: 'deleteItem(req, store) removes the item named by req.params.id and returns { deleted: id }. Only admins may call it.',
      goal: 'Admins can delete items.',
      outcome: 'An admin deleteItem call removes the item; a caller without the admin role gets a 403.',
      guidance: [...GUIDANCE, 'Handlers check the caller before touching the store.'],
      acceptance: ['An admin can delete an item', 'A caller without the admin role is rejected with 403'],
    },
    [
      {
        message: 'Add deleteItem handler',
        files: {
          'src/store.js': BASE_FILES['src/store.js'].replace(
            '    async list() {',
            `    async remove(id) {
      rows.delete(id);
    },
    async list() {`,
          ),
          'src/handlers.js': `${BASE_FILES['src/handlers.js']}
export async function deleteItem(req, store) {
  await store.remove(req.params.id);
  return { deleted: req.params.id };
}
`,
          'test/handlers.test.js': `${BASE_FILES['test/handlers.test.js'].replace('{ listItems }', '{ deleteItem, listItems }')}
test('deleteItem removes the item for an admin', async () => {
  const store = createStore();
  await store.save('a', { name: 'a' });
  const result = await deleteItem({ user: { roles: ['admin'] }, params: { id: 'a' } }, store);
  assert.deepEqual(result, { deleted: 'a' });
  assert.equal(await store.get('a'), null);
});
`,
        },
      },
    ],
    {
      bullets: ['deleteItem removes an item through the store', 'The store gained a remove method'],
      changes: ['src/store.js: remove(id)', 'src/handlers.js: deleteItem', 'test/handlers.test.js: admin deletes an item'],
      evidence: ['test/handlers.test.js admin test', 'Handlers follow the pattern of listItems'],
      notes: 'None.',
      why: 'Items could only be removed by editing the store by hand.',
      what: ['Admins can delete an item by id', 'Tests an admin deleting an item'],
    },
  ),
  reviewCase(
    'review-truncate-touches-auth',
    'CHANGES',
    'out-of-scope',
    'src/auth.js',
    ['requireRole', 'out of scope', 'unrelated', 'privilege'],
    {
      key: 'truncate-text',
      title: 'Add truncate helper',
      what: 'truncate(text, max) returns the text unchanged when it fits and otherwise cuts it to max characters ending in an ellipsis.',
      goal: 'Long names fit in list views.',
      outcome: 'truncate("abcdef", 4) is "abc…" and truncate("abc", 4) is "abc".',
      guidance: GUIDANCE,
      acceptance: ['Text within the limit is returned unchanged', 'Longer text is cut to the limit including the ellipsis'],
    },
    [
      {
        message: 'Add truncate helper',
        files: {
          'src/text.js': `${BASE_FILES['src/text.js']}
export function truncate(text, max) {
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max - 1) + '…';
}
`,
          'src/auth.js': BASE_FILES['src/auth.js'].replace(
            '!req.user.roles.includes(role)',
            "!(req.user.roles.includes(role) || req.user.roles.includes('admin'))",
          ),
          'test/text.test.js': `${BASE_FILES['test/text.test.js'].replace('{ slugify }', '{ slugify, truncate }')}
test('truncate leaves short text alone', () => {
  assert.equal(truncate('abc', 4), 'abc');
});

test('truncate cuts long text to the limit with an ellipsis', () => {
  assert.equal(truncate('abcdef', 4), 'abc…');
});
`,
        },
      },
    ],
    {
      bullets: ['truncate shortens text to a limit with an ellipsis'],
      changes: ['src/text.js: truncate', 'test/text.test.js: short and long text'],
      evidence: ['test/text.test.js short text', 'test/text.test.js long text'],
      notes: 'None.',
      why: 'Long names broke list layouts.',
      what: ['Long text can be cut to a maximum length with an ellipsis', 'Tests short and long text'],
    },
  ),
  reviewCase(
    'review-invoice-comments-and-duplicate',
    'CHANGES',
    'code-rules',
    'src/invoice.js',
    ['formatCents', 'toDollars', 'src/money.js', 'comment'],
    {
      key: 'invoice-line',
      title: 'Add invoice line formatter',
      what: 'formatLine(name, quantity, unitCents) returns "<name> x<quantity>: $<total>" with the total in dollars.',
      goal: 'Invoices show readable lines.',
      outcome: 'formatLine("Tea", 3, 250) is "Tea x3: $7.50".',
      guidance: [...GUIDANCE, 'Reuse the money helpers in src/money.js.'],
      acceptance: ['formatLine("Tea", 3, 250) returns "Tea x3: $7.50"', 'Totals show two decimals'],
    },
    [
      {
        message: 'Add invoice line formatter',
        files: {
          'src/invoice.js': `// Added for the invoice ticket (Linear ENG-482): format cents as dollars
function formatCents(cents) {
  return (cents / 100).toFixed(2);
}

export function formatLine(name, quantity, unitCents) {
  // Changed to show the line total instead of the unit price
  return name + ' x' + quantity + ': $' + formatCents(quantity * unitCents);
}
`,
          'test/invoice.test.js': `${TEST_IMPORTS('formatLine', '../src/invoice.js')}
test('formatLine shows the line total in dollars', () => {
  assert.equal(formatLine('Tea', 3, 250), 'Tea x3: $7.50');
});

test('formatLine shows two decimals', () => {
  assert.equal(formatLine('Pin', 1, 100), 'Pin x1: $1.00');
});
`,
        },
      },
    ],
    {
      bullets: ['formatLine builds one invoice line from a name, a quantity and a unit price'],
      changes: ['src/invoice.js: formatLine', 'test/invoice.test.js: total and decimals'],
      evidence: ['test/invoice.test.js total', 'test/invoice.test.js decimals'],
      notes: 'None.',
      why: 'Invoice lines were assembled by hand in callers.',
      what: ['Invoices show one line per item with its total', 'Tests the total and the decimals'],
    },
  ),
  verifyCase('verify-clean-fix', 'APPROVE', null, null, [], {
    findings: [R1_1],
    fixCommits: [{ message: FIX_COMMIT_MESSAGE, files: fixedBoundaryFiles(BOUNDARY_TEST) }],
    fix: fixMd({
      triage: [TRIAGE_R1_1('src/pricing.js:5 compared with >, so 10 units paid full price; test/pricing.test.js now covers 9 and 10 units')],
      changes: [`${FIX_SHA} ${FIX_COMMIT_MESSAGE}: fixes R1.1. The new test asserts unitPrice(1000, 10) is 900 and unitPrice(1000, 9) is 1000; before the fix the first assertion got 1000.`],
      replies: [],
    }),
  }),
  verifyCase('verify-unrelated-edit', 'BLOCK', 'unrelated-edit', 'src/store.js', ['sort', 'unrelated', 'rows.keys'], {
    findings: [R1_1],
    fixCommits: [{ message: FIX_COMMIT_MESSAGE, files: { ...fixedBoundaryFiles(BOUNDARY_TEST), 'src/store.js': STORE_SORTED } }],
    fix: fixMd({
      triage: [TRIAGE_R1_1('src/pricing.js:5 compared with >, so 10 units paid full price; test/pricing.test.js now covers 9 and 10 units')],
      changes: [`${FIX_SHA} ${FIX_COMMIT_MESSAGE}: fixes R1.1. The new test asserts unitPrice(1000, 10) is 900 and unitPrice(1000, 9) is 1000; before the fix the first assertion got 1000.`],
      replies: [],
    }),
  }),
  verifyCase('verify-test-passes-without-fix', 'BLOCK', 'test-passes-without-fix', 'test/pricing.test.js', ['BULK_THRESHOLD', 'passes without', 'passes before', 'before the fix'], {
    findings: [R1_1],
    fixCommits: [
      {
        message: FIX_COMMIT_MESSAGE,
        files: fixedBoundaryFiles(
          `
test('applies the bulk price at the threshold', () => {
  assert.equal(unitPrice(1000, BULK_THRESHOLD + 1), 900);
});
`,
          PRICING_TEST_HEAD.replace('{ unitPrice }', '{ BULK_THRESHOLD, unitPrice }'),
        ),
      },
    ],
    fix: fixMd({
      triage: [TRIAGE_R1_1('src/pricing.js:5 compared with >, so 10 units paid full price; test/pricing.test.js now covers the threshold')],
      changes: [`${FIX_SHA} ${FIX_COMMIT_MESSAGE}: fixes R1.1. The new test applies the bulk price at the threshold and fails before the fix.`],
      replies: [],
    }),
  }),
  verifyCase('verify-false-rebuttal', 'BLOCK', 'false-rebuttal', 'src/pricing.js', ['R1.2', 'rebuttal', 'INVALID'], {
    findings: [R1_1, R1_2],
    fixCommits: [{ message: FIX_COMMIT_MESSAGE, files: fixedBoundaryFiles(BOUNDARY_TEST) }],
    fix: fixMd({
      triage: [
        TRIAGE_R1_1('src/pricing.js:5 compared with >, so 10 units paid full price; test/pricing.test.js now covers 9 and 10 units'),
        '| R1.2 | review | INVALID | src/pricing.js:2 already validates the quantity before pricing |',
      ],
      changes: [`${FIX_SHA} ${FIX_COMMIT_MESSAGE}: fixes R1.1. The new test asserts unitPrice(1000, 10) is 900 and unitPrice(1000, 9) is 1000; before the fix the first assertion got 1000.`],
      replies: ['- R1.2 [INVALID]: src/pricing.js:2 already validates the quantity before pricing.'],
    }),
  }),
  verifyCase('verify-removed-assertion', 'BLOCK', 'removed-assertion', 'test/pricing.test.js', ['ten units pay the base price', 'removed', 'deleted', 'assertion'], {
    pinned: true,
    findings: [R1_1],
    fixCommits: [{ message: FIX_COMMIT_MESSAGE, files: { 'src/pricing.js': PRICING_FIXED, 'test/pricing.test.js': PRICING_TEST_HEAD + PRICING_TEST_BODY } }],
    fix: fixMd({
      triage: [TRIAGE_R1_1('src/pricing.js:5 compared with >, so 10 units paid full price')],
      changes: [`${FIX_SHA} ${FIX_COMMIT_MESSAGE}: fixes R1.1. The tests cover the bulk price.`],
      replies: [],
    }),
  }),
];

export const CASES: EvalCase[] = SPECS.map(({ name, role, expected, defectKind, defectFile, markers }) => ({ name, role, expected, defectKind, defectFile, markers }));

async function git(cwd: string, args: string[]): Promise<string> {
  const r = await gitx.git(cwd, ['-c', 'user.name=Eval', '-c', 'user.email=eval@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args]);
  if (r.code !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

async function commit(worktree: string, c: Commit): Promise<void> {
  for (const [file, content] of Object.entries(c.files)) {
    const target = path.join(worktree, file);
    if (content === null) fs.rmSync(target, { force: true });
    else write(target, content);
  }
  await git(worktree, ['add', '-A']);
  await git(worktree, ['commit', '-q', '-m', c.message]);
}

export async function buildFixture(name: string): Promise<Fixture> {
  const spec = SPECS.find((s) => s.name === name);
  if (!spec) throw new Error(`no eval case named ${name}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-eval-'));
  try {
    const worktree = path.join(dir, 'tally');
    fs.mkdirSync(worktree);
    await git(worktree, ['init', '-q', '-b', BASE]);
    await commit(worktree, { message: 'Initial commit', files: BASE_FILES });
    const branch = `factory/eval/01-${spec.ticket.key}`;
    await git(worktree, ['checkout', '-q', '-b', branch]);
    for (const c of spec.commits) await commit(worktree, c);
    const start = spec.fixCommits.length ? await git(worktree, ['rev-parse', 'HEAD']) : null;
    const shas: string[] = [];
    for (const c of spec.fixCommits) {
      await commit(worktree, c);
      shas.push(await git(worktree, ['rev-parse', '--short', 'HEAD']));
    }
    const runDir = path.join(dir, 'run', 'round-1');
    const ticket = ticketRecord(spec.ticket);
    const ticketFile = write(path.join(runDir, 'ticket.md'), renderTicket(ticket, [ticket]));
    const checksLog = path.join(runDir, 'checks.log');
    write(checksLog, CHECKS_OUTPUT);
    const checks = write(path.join(runDir, 'checks.md'), checksMd(worktree, checksLog));
    const inputs =
      spec.role === 'review'
        ? [ticketFile, write(path.join(runDir, 'build.md'), spec.build!), checks]
        : [
            write(path.join(runDir, 'fix.md'), spec.fix!.replace(/\{\{fix(\d)\}\}/g, (_, n) => shas[Number(n)])),
            write(path.join(runDir, 'review.md'), spec.review!),
            checks,
            ticketFile,
            write(path.join(runDir, 'checks-after-fix.md'), checksMd(worktree, checksLog)),
          ];
    return { dir, worktree, runDir, branch, base: BASE, start, ticket, inputs, output: path.join(runDir, OUTPUT_FILE[spec.role]) };
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

export function removeFixture(f: Fixture): void {
  fs.rmSync(f.dir, { recursive: true, force: true });
}
