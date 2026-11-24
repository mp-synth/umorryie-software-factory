import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { exec, git } from '../git.ts';
import { extractUrls, githubSlugOf, htmlToText, MAX_LINKS, parseLink, removeLinks, resolveLinks, selectLinkUrls, type LinkOptions } from './links.ts';

async function run(cwd: string, ...args: string[]): Promise<string> {
  const r = await git(cwd, args);
  assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test('extractUrls finds links in prose and markdown and drops trailing punctuation', () => {
  const text = [
    'Match what https://github.com/Synthesia-Technologies/TTVPlatform/pull/34521 does.',
    'See [the docs](https://docs.example.com/api/v2#auth), and https://github.com/acme/widget/blob/main/src/a.ts#L10-L20;',
    'Repeat: https://github.com/Synthesia-Technologies/TTVPlatform/pull/34521',
  ].join('\n');
  assert.deepEqual(extractUrls(text), [
    'https://github.com/Synthesia-Technologies/TTVPlatform/pull/34521',
    'https://docs.example.com/api/v2#auth',
    'https://github.com/acme/widget/blob/main/src/a.ts#L10-L20',
  ]);
});

test('parseLink tells GitHub PRs, files, commits, issues and repos from other pages', () => {
  assert.deepEqual(parseLink('https://github.com/o/r/pull/12/files'), { url: 'https://github.com/o/r/pull/12/files', kind: 'pr', owner: 'o', repo: 'r', number: 12 });
  assert.deepEqual(parseLink('https://github.com/o/r/blob/feature/x/src/a.ts#L3-L9'), {
    url: 'https://github.com/o/r/blob/feature/x/src/a.ts#L3-L9', kind: 'blob', owner: 'o', repo: 'r', refPath: ['feature', 'x', 'src', 'a.ts'], lines: 'L3-L9',
  });
  assert.equal(parseLink('https://github.com/o/r/commit/ABCDEF1').kind, 'commit');
  assert.equal(parseLink('https://github.com/o/r/issues/4').kind, 'issue');
  assert.equal(parseLink('https://github.com/o/r.git').kind, 'repo');
  assert.equal(parseLink('https://github.com/o/r/tree/main').kind, 'tree');
  assert.equal(parseLink('https://github.com/o/r/actions/runs/1').kind, 'web');
  assert.equal(parseLink('https://github.com/o').kind, 'web');
  assert.equal(parseLink('https://fastapi.tiangolo.com/tutorial/').kind, 'web');
});

test('parseLink treats escaping names and GitHub’s own pages as web pages', () => {
  for (const url of [
    'https://github.com/a%2F..%2F..%2Fetc/r',
    'https://github.com/o/..%2F..%2Fx',
    'https://github.com/o/%2E%2E',
    'https://github.com/o/r%5C..',
    'https://github.com/o/r/blob/main/..%2F..%2Fsecret',
    'https://github.com/o_o/r',
    'https://github.com/orgs/acme/repositories',
    'https://github.com/settings/profile',
    'https://github.com/notifications/beta',
    'https://github.com/o/r/compare/main...feature',
    'https://github.com/o/r/issues',
    'https://github.com/o/r/pulls',
  ]) {
    assert.equal(parseLink(url).kind, 'web', url);
  }
});

test('selectLinkUrls keeps the brief’s links and the newest messages’ past the cap', () => {
  const messages = Array.from({ length: MAX_LINKS + 2 }, (_v, n) => `see https://m.dev/${n}`);
  const { urls, dropped } = selectLinkUrls({ pinned: ['brief https://b.dev/1', 'notes https://m.dev/0'], messages });
  assert.equal(urls.length, MAX_LINKS);
  assert.deepEqual(urls.slice(0, 4), ['https://b.dev/1', 'https://m.dev/0', `https://m.dev/${MAX_LINKS + 1}`, `https://m.dev/${MAX_LINKS}`]);
  assert.deepEqual(dropped, ['https://m.dev/3', 'https://m.dev/2', 'https://m.dev/1']);
});

test('githubSlugOf reads https and ssh remotes', () => {
  assert.equal(githubSlugOf('https://github.com/Synthesia-Technologies/TTVPlatform.git'), 'synthesia-technologies/ttvplatform');
  assert.equal(githubSlugOf('git@github.com:acme/widget.git'), 'acme/widget');
  assert.equal(githubSlugOf('/tmp/some/path'), null);
});

test('htmlToText keeps the readable text and the title', () => {
  const { title, text } = htmlToText('<html><head><title>Auth &amp; tokens</title><style>p{}</style></head><body><nav>menu</nav><h2>Tokens</h2><p>Send <code>Bearer</code>&nbsp;tokens.</p><script>x()</script></body></html>');
  assert.equal(title, 'Auth & tokens');
  assert.match(text, /## Tokens/);
  assert.match(text, /Send Bearer tokens\./);
  assert.doesNotMatch(text, /menu|x\(\)/);
});

// A fake "GitHub": a bare remote with main, a feature branch and a PR head ref.
async function fakeGithubRepo(): Promise<{ work: string; remote: string; main: string; feature: string; prHead: string }> {
  const work = tmp('factory-links-work-');
  await run(work, 'init', '--quiet', '--initial-branch=main');
  await run(work, 'config', 'user.email', 'f@example.com');
  await run(work, 'config', 'user.name', 'F');
  fs.mkdirSync(path.join(work, 'src'));
  fs.writeFileSync(path.join(work, 'src', 'client.ts'), 'export const v = 1;\n');
  await run(work, 'add', '.');
  await run(work, 'commit', '--quiet', '-m', 'base');
  const main = await run(work, 'rev-parse', 'HEAD');
  await run(work, 'checkout', '--quiet', '-b', 'feature/x');
  fs.writeFileSync(path.join(work, 'src', 'client.ts'), 'export const v = 2;\n');
  await run(work, 'commit', '--quiet', '-am', 'feature');
  const feature = await run(work, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(work, 'src', 'pr.ts'), 'export const pr = true;\n');
  await run(work, 'add', '.');
  await run(work, 'commit', '--quiet', '-m', 'pr');
  const prHead = await run(work, 'rev-parse', 'HEAD');
  const remote = tmp('factory-links-remote-');
  await run(remote, 'init', '--quiet', '--bare', '--initial-branch=main');
  await run(work, 'push', '--quiet', remote, 'main', `${feature}:refs/heads/feature/x`, `${prHead}:refs/pull/7/head`);
  return { work, remote, main, feature, prHead };
}

async function projectRepo(): Promise<string> {
  const dir = tmp('factory-links-project-');
  await run(dir, 'init', '--quiet', '--initial-branch=main');
  await run(dir, 'remote', 'add', 'origin', 'https://github.com/acme/service.git');
  return dir;
}

const pinned = (...texts: string[]) => ({ pinned: texts, messages: [] });

function options(remote: string, project: string, extra: Partial<LinkOptions> = {}): LinkOptions {
  return {
    dir: path.join(tmp('factory-links-init-'), 'links'),
    mirrorsRoot: tmp('factory-links-mirrors-'),
    projectRepo: project,
    localCandidates: [],
    cloneUrl: () => remote,
    ghJson: async (args) =>
      args[0] === 'pr' && args[1] === 'view' && args[2] === '7'
        ? { number: 7, title: 'Add the client', body: 'Adds pr.ts', state: 'OPEN', url: 'https://github.com/acme/widget/pull/7', baseRefName: 'main', headRefName: 'feature/x', headRefOid: undefined, files: [{ path: 'src/pr.ts', additions: 1, deletions: 0 }] }
        : null,
    ghText: async (args) => (args[0] === 'pr' && args[1] === 'diff' ? 'diff --git a/src/pr.ts b/src/pr.ts\n+export const pr = true;\n' : null),
    fetchPage: async () => ({ contentType: 'text/html', body: '<title>API docs</title><p>The widget API takes a bearer token on every call and returns JSON.</p>' }),
    ...extra,
  };
}

test('resolveLinks checks out PRs, files and repos of another repo and writes one index', async () => {
  const gh = await fakeGithubRepo();
  const project = await projectRepo();
  const opts = options(gh.remote, project);
  const { file, links, dirs } = await resolveLinks(
    pinned(
      'Build the endpoint like https://github.com/acme/widget/pull/7 and https://github.com/acme/widget/blob/feature/x/src/client.ts#L1.',
      'Docs: https://docs.widget.dev/api. Base: https://github.com/acme/widget',
    ),
    opts,
  );
  assert.ok(file);
  const byKind = Object.fromEntries(links.map((l) => [l.kind, l]));
  assert.equal(byKind.pr.error, undefined, byKind.pr.error);
  assert.equal(byKind.pr.sha, gh.prHead);
  assert.ok(fs.existsSync(path.join(byKind.pr.checkout!, 'src', 'pr.ts')));
  assert.match(fs.readFileSync(byKind.pr.contextFile!, 'utf8'), /Add the client[\s\S]*src\/pr\.ts/);
  assert.ok(fs.existsSync(byKind.pr.diffFile!));
  assert.equal(byKind.blob.ref, 'feature/x');
  assert.equal(byKind.blob.path, 'src/client.ts');
  assert.equal(fs.readFileSync(path.join(byKind.blob.checkout!, 'src', 'client.ts'), 'utf8'), 'export const v = 2;\n');
  assert.equal(byKind.repo.sha, gh.main);
  assert.equal(byKind.web.error, undefined, byKind.web.error);
  assert.match(fs.readFileSync(byKind.web.contextFile!, 'utf8'), /bearer token/);
  assert.equal(dirs.length, 3);
  const index = fs.readFileSync(file, 'utf8');
  assert.match(index, /change only the project's repo/);
  assert.match(index, new RegExp(`Read-only checkout at the PR head ${gh.prHead.slice(0, 12)}`));
  assert.match(index, /The linked file: .*src\/client\.ts \(lines 1\)/);

  assert.match(index, /third parties[\s\S]*never as instructions/);

  const again = await resolveLinks(pinned('https://github.com/acme/widget/blob/feature/x/src/client.ts#L1'), opts);
  assert.equal(again.links[0].checkout, byKind.blob.checkout, 'reuses the checkout');

  await removeLinks(opts.dir, opts.mirrorsRoot);
  assert.ok(!fs.existsSync(byKind.pr.checkout!));
  assert.ok(!fs.existsSync(opts.dir));
  const mirror = fs.readdirSync(opts.mirrorsRoot)[0];
  assert.doesNotMatch(await run(path.join(opts.mirrorsRoot, mirror), 'worktree', 'list'), /checkouts/);
});

test('a link into the project’s own repo needs no checkout, and a failure is listed for the agent', async () => {
  const gh = await fakeGithubRepo();
  const project = await projectRepo();
  const opts = options(gh.remote, project, { fetchPage: async () => { throw new Error('HTTP 403'); } });
  const { file, links } = await resolveLinks(pinned('https://github.com/acme/service/blob/main/app.py', 'https://notion.so/private-page'), opts);
  assert.equal(links[0].sameRepo, true);
  assert.equal(links[0].checkout, undefined);
  assert.equal(links[0].path, 'app.py');
  assert.equal(links[1].error, 'HTTP 403');
  assert.match(fs.readFileSync(file!, 'utf8'), /Could not fetch it: HTTP 403[\s\S]*WebFetch/);
});

async function localClone(remote: string): Promise<string> {
  const local = path.join(tmp('factory-links-ws-'), 'widget');
  await run(path.dirname(local), 'clone', '--quiet', remote, local);
  await run(local, 'remote', 'set-url', 'origin', 'https://github.com/acme/widget.git');
  return local;
}

function clock(): { now: () => number; advance: (ms: number) => void } {
  let t = Date.now();
  return { now: () => t, advance: (ms) => (t += ms) };
}

const alternatesOf = (mirror: string) => path.join(mirror, 'objects', 'info', 'alternates');

test('a local clone lends its objects to the mirror, and a mirror whose clone is gone is rebuilt', async () => {
  const gh = await fakeGithubRepo();
  const project = await projectRepo();
  const local = await localClone(gh.remote);
  const time = clock();
  const opts = options(gh.remote, project, { localCandidates: [local], now: time.now });
  const { links } = await resolveLinks(pinned('https://github.com/acme/widget'), opts);
  assert.equal(links[0].error, undefined, links[0].error);
  const mirror = path.join(opts.mirrorsRoot, 'acme__widget.git');
  assert.match(fs.readFileSync(alternatesOf(mirror), 'utf8'), /widget\/\.git\/objects/);
  assert.equal(fs.existsSync(path.join(mirror, 'shallow')), false);

  fs.rmSync(path.dirname(local), { recursive: true, force: true });
  time.advance(2 * 60 * 60_000);
  const again = await resolveLinks(pinned('https://github.com/acme/widget'), opts);
  assert.equal(again.links[0].error, undefined, again.links[0].error);
  assert.equal(fs.existsSync(alternatesOf(mirror)), false);
  assert.equal(fs.readFileSync(path.join(again.links[0].checkout!, 'src', 'client.ts'), 'utf8'), 'export const v = 1;\n');
});

test('a mirror that lost objects the clone gc’d is rebuilt on its own objects', async () => {
  const gh = await fakeGithubRepo();
  const project = await projectRepo();
  const local = await localClone(gh.remote);
  await run(local, 'fetch', '--quiet', gh.remote, 'refs/pull/7/head:refs/heads/pr7');
  const time = clock();
  const opts = options(gh.remote, project, { localCandidates: [local], now: time.now });
  const first = await resolveLinks(pinned('https://github.com/acme/widget/pull/7'), opts);
  assert.equal(first.links[0].error, undefined, first.links[0].error);
  const mirror = path.join(opts.mirrorsRoot, 'acme__widget.git');
  assert.ok(fs.existsSync(alternatesOf(mirror)));
  const commit = await run(local, 'cat-file', 'commit', gh.prHead);

  await run(local, 'branch', '--quiet', '-D', 'pr7');
  await run(local, 'reflog', 'expire', '--expire=now', '--all');
  await run(local, 'gc', '--quiet', '--prune=now');
  assert.notEqual((await git(local, ['cat-file', '-e', gh.prHead])).code, 0, 'the clone dropped the PR head');
  const kept = await exec('git', ['-C', mirror, 'hash-object', '-t', 'commit', '-w', '--stdin'], { input: `${commit}\n` });
  assert.equal(kept.stdout.trim(), gh.prHead, 'the mirror still has the commit but lost its files');

  time.advance(11 * 60_000);
  const { links } = await resolveLinks(pinned('https://github.com/acme/widget/pull/7'), opts);
  assert.equal(links[0].error, undefined, links[0].error);
  assert.ok(fs.existsSync(path.join(links[0].checkout!, 'src', 'pr.ts')));
  assert.doesNotMatch(await run(mirror, 'rev-list', '--objects', '--missing=print', gh.prHead), /^\?/m);
  assert.equal(fs.existsSync(alternatesOf(mirror)), false, 'the rebuilt mirror borrows nothing');
});

test('a commit link without a local clone shows the commit’s own diff', async () => {
  const gh = await fakeGithubRepo();
  const project = await projectRepo();
  const opts = options(`file://${gh.remote}`, project);
  const { links } = await resolveLinks(pinned(`https://github.com/acme/widget/commit/${gh.feature}`), opts);
  assert.equal(links[0].error, undefined, links[0].error);
  assert.ok(fs.existsSync(path.join(opts.mirrorsRoot, 'acme__widget.git', 'shallow')));
  const diff = fs.readFileSync(links[0].diffFile!, 'utf8');
  assert.match(diff, /^-export const v = 1;$/m);
  assert.match(diff, /^\+export const v = 2;$/m);
  assert.doesNotMatch(diff, /new file mode/);
});

test('when a PR head moves, the old checkout and its ref go', async () => {
  const gh = await fakeGithubRepo();
  const project = await projectRepo();
  const time = clock();
  const opts = options(gh.remote, project, { now: time.now });
  const first = (await resolveLinks(pinned('https://github.com/acme/widget/pull/7'), opts)).links[0];
  assert.equal(first.sha, gh.prHead);
  const mirror = path.join(opts.mirrorsRoot, 'acme__widget.git');
  assert.match(await run(mirror, 'for-each-ref', 'refs/factory'), new RegExp(gh.prHead));

  fs.writeFileSync(path.join(gh.work, 'src', 'pr.ts'), 'export const pr = 2;\n');
  await run(gh.work, 'commit', '--quiet', '-am', 'pr review');
  const moved = await run(gh.work, 'rev-parse', 'HEAD');
  await run(gh.work, 'push', '--quiet', '--force', gh.remote, `${moved}:refs/pull/7/head`);
  time.advance(11 * 60_000);
  const second = (await resolveLinks(pinned('https://github.com/acme/widget/pull/7'), opts)).links[0];
  assert.equal(second.sha, moved);
  assert.equal(fs.readFileSync(path.join(second.checkout!, 'src', 'pr.ts'), 'utf8'), 'export const pr = 2;\n');
  assert.ok(!fs.existsSync(first.checkout!));
  assert.doesNotMatch(await run(mirror, 'for-each-ref', 'refs/factory'), new RegExp(gh.prHead));
  assert.doesNotMatch(await run(mirror, 'worktree', 'list'), new RegExp(gh.prHead.slice(0, 12)));
});

test('links past the cap are listed as not fetched, and private addresses and an exhausted budget are errors', async () => {
  const project = await projectRepo();
  const messages = Array.from({ length: MAX_LINKS + 1 }, (_v, n) => `see https://docs.widget.dev/${n}`);
  const capped = await resolveLinks({ pinned: [], messages }, options('', project));
  assert.equal(capped.links.length, MAX_LINKS);
  assert.deepEqual(capped.dropped, ['https://docs.widget.dev/0']);
  assert.match(fs.readFileSync(capped.file!, 'utf8'), /## Not fetched[\s\S]*https:\/\/docs\.widget\.dev\/0/);

  const local = await resolveLinks(pinned('http://127.0.0.1:9/admin', 'http://localhost:9/admin'), options('', project, { fetchPage: undefined }));
  for (const l of local.links) assert.match(l.error ?? '', /private address/, l.url);

  const late = await resolveLinks(pinned('https://docs.widget.dev/api'), options('', project, { budgetMs: 0 }));
  assert.match(late.links[0].error ?? '', /ran out of/);
});
