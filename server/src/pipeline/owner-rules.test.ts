import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { addedDefinitions, checkOwnerRules, findRuleViolations, renderOwnerRules } from './owner-rules.ts';

type Hunk = [start: number, lines: string[], deleted?: string[]];

const fileDiff = (file: string, ...hunks: Hunk[]) =>
  [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    ...hunks.flatMap(([start, lines, deleted = []]) => [
      `@@ -${start},${deleted.length} +${start},${lines.length} @@`,
      ...deleted.map((l) => `-${l}`),
      ...lines.map((l) => `+${l}`),
    ]),
  ].join('\n');

const added = (file: string, ...lines: string[]) => fileDiff(file, [1, lines]);
const linesBreaking = (rule: string, file: string, ...lines: string[]) =>
  findRuleViolations(added(file, ...lines))
    .filter((v) => v.rule === rule)
    .map((v) => v.line);
const commentLines = (file: string, ...lines: string[]) => linesBreaking('comment', file, ...lines);

test('every allowed directive comment passes', () => {
  const python = [
    '#!/usr/bin/env python3',
    '# -*- coding: utf-8 -*-',
    'import os  # noqa: F401',
    'x = f()  # type: ignore[attr-defined]',
    'if DEBUG:  # pragma: no cover',
    '# pylint: disable=invalid-name',
    'y = 1  # ruff: noqa',
    '# fmt: off',
    '# isort: skip_file',
    '# mypy: ignore-errors',
    '# pyright: basic',
    'subprocess.call(cmd, shell=True)  # nosec',
  ];
  assert.deepEqual(commentLines('app/a.py', ...python), []);
  const script = [
    '// eslint-disable-next-line no-console',
    '/* eslint-disable */',
    '/* eslint-enable */',
    '// @ts-expect-error wrong on purpose',
    '// @ts-ignore',
    '// @ts-nocheck',
    '// prettier-ignore',
    '/* istanbul ignore next */',
    '/* c8 ignore next */',
    '// biome-ignore lint: reason',
    '/// <reference types="node" />',
  ];
  assert.deepEqual(commentLines('web/a.ts', ...script), []);
  assert.deepEqual(commentLines('cmd/main.go', '//go:build linux', '// +build linux', '//go:generate stringer'), []);
});

test('a # or // inside a string literal is not a comment', () => {
  const python = [
    'tag = "#hashtag"',
    "url = 'http://example.com/a#b'",
    'label = f"{count} # items"',
    `quote = "it's # fine"`,
    'nested = f"{row[\'#\']}"',
    'raw = r"\\d+#"',
  ];
  assert.deepEqual(commentLines('app/a.py', ...python), []);
  const script = [
    "const url = 'http://example.com';",
    'const doc = "see // here";',
    'const t = `a // ${b}`;',
    'const re = /\\/\\//g;',
    'const both = `x` + "//" + \'#\';',
    'const ratio = a / b / c;',
  ];
  assert.deepEqual(commentLines('web/a.ts', ...script), []);
  assert.deepEqual(commentLines('cmd/main.go', 'u := `http://x`', 'r := \'/\''), []);
  assert.deepEqual(commentLines('src/lib.rs', 'fn f<\'a>(x: &\'a str) -> &\'a str { x } // returns x', "let c = '/';"), [1]);
});

test('python triple-quoted strings and docstrings are not comments', () => {
  const lines = ['def count():', '    """Return the # of items.', '', '    // not a comment either', '    """', '    return 1  # but this is'];
  assert.deepEqual(commentLines('app/a.py', ...lines), [6]);
});

test('a template literal spanning lines hides // until it closes', () => {
  assert.deepEqual(commentLines('web/a.ts', 'const q = `', 'http://x', '`; // after'), [3]);
});

test('trailing comments after code are violations', () => {
  assert.deepEqual(commentLines('app/a.py', 'x = 1  # set x', 'y = 2'), [1]);
  assert.deepEqual(commentLines('web/a.ts', 'foo(); // call foo', "const a = 'x'; /* why */", 'bar();'), [1, 2]);
  assert.deepEqual(commentLines('lib/a.rb', 'name = "#{first}"  # full name'), [1]);
  assert.deepEqual(commentLines('src/A.java', 'char c = \'"\'; // quote'), [1]);
});

test('every line of a block comment is a violation, and code after it is not', () => {
  assert.deepEqual(commentLines('web/a.ts', '/* start', 'middle', ' * star', ' */', 'run();', 'go(/* inline */ 1);'), [1, 2, 3, 4, 6]);
});

test('JSDoc blocks are violations, including a hunk that starts inside one', () => {
  assert.deepEqual(commentLines('web/a.ts', '/**', ' * Does a thing.', ' */', 'export function f() {}'), [1, 2, 3]);
  const insideExisting = fileDiff('web/b.ts', [10, [' * @param x the value (optional)', ' */']], [30, ['  * rate;']]);
  assert.deepEqual(
    findRuleViolations(insideExisting).map((v) => v.line),
    [10, 11],
  );
});

test('reports file and new-file line across hunks and files, ignoring deleted lines', () => {
  const diff = [
    fileDiff('app/a.py', [5, ['x = 1  # one'], ['old', 'older']], [40, ['y = 2', 'z = 3  # three']]),
    fileDiff('web/b.ts', [7, ['// seven']]),
    'diff --git a/gone.py b/gone.py',
    '--- a/gone.py',
    '+++ /dev/null',
    '@@ -1,1 +0,0 @@',
    '-# removed',
  ].join('\n');
  assert.deepEqual(findRuleViolations(diff), [
    { file: 'app/a.py', line: 5, rule: 'comment', text: 'x = 1  # one' },
    { file: 'app/a.py', line: 41, rule: 'comment', text: 'z = 3  # three' },
    { file: 'web/b.ts', line: 7, rule: 'comment', text: '// seven' },
  ]);
});

test('a deleted line that looks like a file header does not end the hunk', () => {
  const diff = ['diff --git a/a.py b/a.py', '--- a/a.py', '+++ b/a.py', '@@ -1,1 +1,1 @@', '--- a/x', '+x = 1  # c'].join('\n');
  assert.deepEqual(findRuleViolations(diff).map((v) => [v.file, v.line]), [['a.py', 1]]);
});

test('skips generated, vendored and non-code files, and whatever skip says', () => {
  const skipped = [
    'api/generated/client.ts',
    'web/__generated__/types.ts',
    'vendor/lib/a.go',
    'node_modules/x/index.js',
    'web/dist/app.js',
    'build/out.py',
    'proto/idl/thing.py',
    'web/api.gen.ts',
    'web/types.d.ts',
    'app/thing_pb2.py',
    'README.md',
    'config.yaml',
    'pnpm-lock.yaml',
  ];
  assert.deepEqual(skipped.flatMap((file) => findRuleViolations(added(file, '# note', '// note'))), []);
  assert.equal(findRuleViolations(added('scripts/build.py', '# note')).length, 1, 'a file named build is still checked');
  assert.deepEqual(findRuleViolations(added('app/a.py', '# note'), { skip: (file) => file.startsWith('app/') }), []);
});

test('flags a linear.app URL anywhere and a Linear issue key in a comment', () => {
  assert.deepEqual(findRuleViolations(added('app/a.py', 'URL = "https://linear.app/acme/issue/ENT-1"')), [
    { file: 'app/a.py', line: 1, rule: 'linear', text: 'URL = "https://linear.app/acme/issue/ENT-1"' },
  ]);
  assert.deepEqual(
    findRuleViolations(added('web/a.ts', 'run(); // see ENT-4547')).map((v) => v.rule),
    ['comment', 'linear'],
  );
  assert.deepEqual(linesBreaking('linear', 'app/a.py', '# LIN-12 follow-up', 'key = "ENT-4547"', '# encode as UTF-8, hash with SHA-256'), [1]);
});

test('reports the trimmed line, cut at 160 characters', () => {
  const [violation] = findRuleViolations(added('app/a.py', `    # ${'x'.repeat(300)}`));
  assert.equal(violation.text.length, 160);
  assert.match(violation.text, /^# x/);
});

test('lists the Python definitions a diff adds', () => {
  const lines = [
    'def get_total(orders):',
    'async def send_report():',
    'class InvoiceBuilder(Base):',
    '    def build(self):',
    '    def __init__(self):',
    'MAX_RETRIES = 3',
    'TIMEOUT: int = 30',
    '    LOCAL_LIMIT = 4',
    'lower_case = 1',
    'def test_something():',
    'class TestThing:',
    'if MAX_RETRIES == 3:',
  ];
  assert.deepEqual(addedDefinitions(fileDiff('app/billing.py', [10, lines])), [
    { file: 'app/billing.py', line: 10, name: 'get_total', kind: 'function' },
    { file: 'app/billing.py', line: 11, name: 'send_report', kind: 'function' },
    { file: 'app/billing.py', line: 12, name: 'InvoiceBuilder', kind: 'class' },
    { file: 'app/billing.py', line: 13, name: 'build', kind: 'function' },
    { file: 'app/billing.py', line: 15, name: 'MAX_RETRIES', kind: 'constant' },
    { file: 'app/billing.py', line: 16, name: 'TIMEOUT', kind: 'constant' },
  ]);
});

test('lists the TypeScript and JavaScript definitions a diff adds', () => {
  const lines = [
    'function parseRow(row) {',
    'export function renderTable() {',
    'export async function loadRows() {',
    'const toCents = (amount: number): number => amount * 100;',
    'export const fetchAll = async (ids: string[]) => {',
    'const double = x => x * 2;',
    'export const LIMIT = 10;',
    'const RETRY_DELAY_MS = 500;',
    'export class Store {',
    'const total = (a + b) * 2;',
    'export interface Row { id: string }',
    'export type Id = string;',
    '  const inner = () => 1;',
  ];
  assert.deepEqual(
    addedDefinitions(added('web/table.ts', ...lines)).map((d) => [d.line, d.name, d.kind]),
    [
      [1, 'parseRow', 'function'],
      [2, 'renderTable', 'function'],
      [3, 'loadRows', 'function'],
      [4, 'toCents', 'function'],
      [5, 'fetchAll', 'function'],
      [6, 'double', 'function'],
      [7, 'LIMIT', 'constant'],
      [8, 'RETRY_DELAY_MS', 'constant'],
      [9, 'Store', 'class'],
    ],
  );
});

test('lists nothing from test files', () => {
  const testFiles = ['tests/test_a.py', 'app/tests/helpers.py', 'app/test/x.py', 'app/test_b.py', 'app/b_test.py', 'conftest.py', 'web/__tests__/a.ts', 'web/a.test.ts', 'web/a.spec.tsx'];
  assert.deepEqual(testFiles.flatMap((file) => addedDefinitions(added(file, 'def helper():', 'export function helper() {}'))), []);
});

test('renders nothing when there is nothing to say', () => {
  assert.equal(renderOwnerRules({ violations: [], notes: [] }), '');
});

test('renders Linear references as gate failures and comments with notes as advisory', () => {
  const md = renderOwnerRules({
    violations: [
      { file: 'app/a.py', line: 3, rule: 'comment', text: 'x = 1  # set `x`' },
      { file: 'app/a.py', line: 4, rule: 'linear', text: '# ENT-123' },
    ],
    notes: [{ file: 'app/a.py', line: 9, rule: 'uncalled', text: 'helper', detail: 'only tests use this function' }],
  });
  assert.match(md, /^## Owner rules\n/);
  assert.match(md, /- `app\/a\.py:4` linear: `# ENT-123`/);
  assert.match(md, /## Owner rules to check by hand\n\n.*advisory/);
  assert.match(md, /- `app\/a\.py:3` comment `` x = 1 {2}# set `x` ``: keep it only when it explains why/);
  assert.match(md, /- `app\/a\.py:9` uncalled `helper`: only tests use this function/);
  assert.doesNotMatch(renderOwnerRules({ violations: [], notes: [{ file: 'a.py', line: 1, rule: 'duplicate', text: 'x', detail: 'd' }] }), /^## Owner rules\n/);
});

const run = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

function writeFiles(cwd: string, files: Record<string, string>): void {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    fs.writeFileSync(path.join(cwd, file), text);
  }
  run(cwd, 'add', '-A');
  run(cwd, 'commit', '-q', '-m', 'change');
}

const TOTAL_LINES = [
  '    subtotal = sum(order.amount for order in orders)',
  '    discount = subtotal * 0.1 if subtotal > 100 else 0',
  '    shipping = 0 if subtotal > 50 else 5',
  '    taxes = (subtotal - discount) * 0.2',
  '    total = subtotal - discount + shipping + taxes',
  '    rounded_total = round(total, 2)',
  '    return rounded_total',
];

function repoWith(baseFiles: Record<string, string>, branchFiles: Record<string, string>): { dir: string; base: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-owner-rules-'));
  run(dir, 'init', '-q', '-b', 'main');
  writeFiles(dir, baseFiles);
  const base = run(dir, 'rev-parse', 'HEAD');
  writeFiles(dir, branchFiles);
  return { dir, base };
}

function repoWithBranch(): { dir: string; base: string } {
  return repoWith({ 'app/legacy.py': ['def legacy_total(orders):', ...TOTAL_LINES, ''].join('\n') }, {
    'app/feature.py': [
      'def unused_helper():',
      '    return 2',
      '',
      '',
      'def used_helper():',
      '    return 3',
      '',
      '',
      'def only_tested():',
      '    return 4',
      '',
      '',
      'def run():',
      '    return used_helper()  # calls the helper',
      '',
    ].join('\n'),
    'app/copy.py': ['def copied_total(orders):', ...TOTAL_LINES, ''].join('\n'),
    'app/main.py': ['from app.feature import run', 'from app.copy import copied_total', '', 'run()', 'copied_total([])', ''].join('\n'),
    'tests/test_feature.py': ['from app.feature import only_tested', '', '', 'def test_only():', '    assert only_tested() == 4', ''].join('\n'),
  });
}

test('checks a real branch: comments, uncalled and test-only definitions, and a copied block', async (t) => {
  const { dir, base } = repoWithBranch();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const result = await checkOwnerRules(dir, base);
  assert.deepEqual(result.violations, [{ file: 'app/feature.py', line: 14, rule: 'comment', text: 'return used_helper()  # calls the helper' }]);
  const uncalled = result.notes.filter((n) => n.rule === 'uncalled').map((n) => [n.text, n.line, n.detail]);
  assert.deepEqual(uncalled, [
    ['unused_helper', 1, 'nothing uses this function'],
    ['only_tested', 9, 'only tests use this function'],
  ]);
  const duplicates = result.notes.filter((n) => n.rule === 'duplicate');
  assert.deepEqual(duplicates, [
    { file: 'app/copy.py', line: 2, rule: 'duplicate', text: TOTAL_LINES[0].trim(), detail: '7 lines also at app/legacy.py:2' },
  ]);
  assert.match(renderOwnerRules(result), /`app\/copy\.py:2` duplicate/);
});

test('reports a block copied within the diff once, and never shared parameter or field lists', async (t) => {
  const parameters = ['    name: str,', '    email: str,', '    workspace_id: str,', '    organization_id: str | None = None,', '    role: str = "member",', '    notify: bool = True,', '    **kwargs,'];
  const { dir, base } = repoWith(
    { 'app/main.py': 'print(1)\n' },
    {
      'app/twice.py': ['def first_total(orders):', ...TOTAL_LINES, '', '', 'def second_total(orders):', ...TOTAL_LINES, ''].join('\n'),
      'app/signatures.py': ['def invite(', ...parameters, '):', '    return send(name)', '', '', 'def remind(', ...parameters, '):', '    return queue(email)', ''].join('\n'),
    },
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const duplicates = (await checkOwnerRules(dir, base)).notes.filter((n) => n.rule === 'duplicate');
  assert.deepEqual(
    duplicates.map((n) => [n.file, n.line, n.detail]),
    [['app/twice.py', 2, '7 lines also at app/twice.py:12']],
  );
});

test('returns what it could compute instead of throwing on git errors', async (t) => {
  const { dir, base } = repoWithBranch();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(await checkOwnerRules(dir, 'no-such-ref'), { violations: [], notes: [] });
  const throwing = async () => {
    throw new Error('git exploded');
  };
  assert.deepEqual(await checkOwnerRules(dir, base, { git: throwing }), { violations: [], notes: [] });
  const grepFails = async (cwd: string, args: string[]) => (args[0] === 'grep' ? { code: 2, stdout: '', stderr: 'boom' } : { code: 0, stdout: run(cwd, ...args), stderr: '' });
  const partial = await checkOwnerRules(dir, base, { git: grepFails });
  assert.equal(partial.violations.length, 1);
  assert.deepEqual(partial.notes, []);
});
