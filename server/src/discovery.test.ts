import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { browse, copyFileCandidates, parseDiscoveryReply, resolveDiscovery, suggestFromFiles } from './discovery.ts';

function gitRepo(files: Record<string, string>): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-')));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

test('a pnpm repo gets a frozen install and its static checks, never its tests', async () => {
  const dir = gitRepo({
    'package.json': JSON.stringify({ packageManager: 'pnpm@9.0.0', scripts: { lint: 'eslint .', test: 'vitest', 'test:affected': 'node affected.mjs' } }),
  });
  const s = await suggestFromFiles(dir);
  assert.equal(s.setupCommand, 'pnpm install --frozen-lockfile');
  assert.equal(s.checksCommand, 'pnpm run lint');
});

test('a uv project installs with uv sync, lints with ruff and copies only its gitignored runtime env file', async () => {
  const dir = gitRepo({
    'pyproject.toml': '[project]\nname = "svc"\n\n[tool.ruff]\nline-length = 120\n',
    'uv.lock': '',
    '.gitignore': '.env\n.env.docker\n.env.template.bak\n',
    '.env': 'A=1\n',
    '.env.docker': 'A=2\n',
    '.env.template': 'A=\n',
  });
  const s = await suggestFromFiles(dir);
  assert.equal(s.setupCommand, 'uv sync');
  assert.equal(s.checksCommand, 'uv run ruff check');
  assert.deepEqual(s.copyFiles, ['.env']);
});

test('a gitignored registry login is a copy candidate, but only env files are copied by default', async () => {
  const dir = gitRepo({ 'pyproject.toml': '', 'uv.lock': '', '.gitignore': '.env\nuv.toml\n', '.env': 'A=1\n', 'uv.toml': '[[index]]\n' });
  assert.deepEqual((await copyFileCandidates(dir)).sort(), ['.env', 'uv.toml']);
  assert.deepEqual((await suggestFromFiles(dir)).copyFiles, ['.env']);
});

test('a tracked .env is never offered for copying', async () => {
  const dir = gitRepo({ 'go.mod': 'module x\n', '.env': 'A=1\n' });
  execFileSync('git', ['add', '.env'], { cwd: dir });
  assert.deepEqual((await suggestFromFiles(dir)).copyFiles, []);
});

test('browsing lists visible folders and marks git checkouts', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'browse-')));
  fs.mkdirSync(path.join(root, 'app', '.git'), { recursive: true });
  fs.mkdirSync(path.join(root, 'notes'));
  fs.mkdirSync(path.join(root, '.cache'));
  fs.writeFileSync(path.join(root, 'file.txt'), '');
  const r = browse(root);
  assert.deepEqual(r.entries.map((e) => [e.name, e.git]), [['app', true], ['notes', false]]);
  assert.equal(r.parent, path.dirname(root));
});

test('the discoverer reply is read from its last json block and kept to the offered candidates', () => {
  const reply = parseDiscoveryReply(
    'Draft:\n```json\n{"setupCommand":"x"}\n```\nFinal:\n```json\n' +
      JSON.stringify({
        setupCommand: 'uv sync',
        checksCommand: ' uv run prek run --from-ref "$FACTORY_BASE" --to-ref HEAD ',
        copyFiles: ['.env', '/etc/passwd'],
        referenceDirs: ['lago-python-client', '/Users/me/workspace/lago-api', 'not-a-sibling'],
        evidence: ['CLAUDE.md: uv sync'],
      }) +
      '\n```',
  );
  const siblings = [
    { name: 'lago-python-client', path: '/Users/me/workspace/lago-python-client', git: true },
    { name: 'lago-api', path: '/Users/me/workspace/lago-api', git: true },
  ];
  assert.deepEqual(resolveDiscovery(reply, ['.env'], siblings), {
    setupCommand: 'uv sync',
    checksCommand: 'uv run prek run --from-ref "$FACTORY_BASE" --to-ref HEAD',
    copyFiles: ['.env'],
    referenceDirs: ['/Users/me/workspace/lago-python-client', '/Users/me/workspace/lago-api'],
    prerequisites: [],
    evidence: ['CLAUDE.md: uv sync'],
  });
});
