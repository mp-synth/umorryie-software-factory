import assert from 'node:assert/strict';
import fs from 'node:fs';
import { beforeEach, test } from 'node:test';
import { FACTORY_MARKER } from './github.ts';
import {
  failedJobLog,
  failureExcerpt,
  githubBudget,
  humanChecksOf,
  lightFingerprint,
  openPrsLight,
  prDetails,
  prStates,
  repoOf,
  type GhRunner,
  type LightPr,
} from './pr-view.ts';

const repo = { owner: 'acme', name: 'widgets' };
const fixture = (name: string) => fs.readFileSync(new URL(`./pr-view-fixtures/${name}`, import.meta.url), 'utf8');

type Reply = { code?: number; stdout?: string; stderr?: string };

/** A fake `gh`: each call is answered by the first route whose test matches the call's arguments. */
function fakeGh(routes: [(args: string[]) => boolean, Reply | ((args: string[]) => Reply)][]) {
  const calls: string[][] = [];
  const run: GhRunner = async (args) => {
    calls.push(args);
    const route = routes.find(([matches]) => matches(args));
    if (!route) throw new Error(`unexpected gh call: ${args.join(' ').slice(0, 200)}`);
    const reply = typeof route[1] === 'function' ? route[1](args) : route[1];
    return { code: reply.code ?? 0, stdout: reply.stdout ?? '', stderr: reply.stderr ?? '' };
  };
  return { run, calls };
}

const queryOf = (args: string[]) => args.find((a) => a.startsWith('query=')) ?? '';
const varOf = (args: string[], name: string) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
const isSearch = (args: string[]) => queryOf(args).includes('search(');
const isPage = (args: string[]) => queryOf(args).includes('$cursor');
const isChunk = (args: string[]) => queryOf(args).includes('pr0:pullRequest') && !isPage(args);

beforeEach(() => githubBudget.reset());

test('reads owner and name from GitHub https and ssh remotes only', () => {
  const widgets = { owner: 'acme', name: 'widgets' };
  assert.deepEqual(repoOf('https://github.com/acme/widgets.git'), widgets);
  assert.deepEqual(repoOf('https://github.com/acme/widgets'), widgets);
  assert.deepEqual(repoOf('https://github.com/acme/widgets/'), widgets);
  assert.deepEqual(repoOf('https://x-access-token:abc@github.com/acme/widgets.git'), widgets);
  assert.deepEqual(repoOf('git@github.com:acme/widgets.git'), widgets);
  assert.deepEqual(repoOf('ssh://git@github.com/acme/widgets.git'), widgets);
  assert.deepEqual(repoOf('git@github.com:acme/my.repo-2.git'), { owner: 'acme', name: 'my.repo-2' });
  assert.equal(repoOf('https://gitlab.com/acme/widgets.git'), null);
  assert.equal(repoOf('/Users/me/widgets'), null);
});

test('lists the open PRs of one repo over every page of the search', async () => {
  const gh = fakeGh([
    [(a) => isSearch(a) && !varOf(a, 'after'), { stdout: fixture('light-page-1.json') }],
    [(a) => isSearch(a) && varOf(a, 'after') === 'Y3Vyc29yOjI=', { stdout: fixture('light-page-2.json') }],
  ]);
  const prs = await openPrsLight(gh.run, repo);
  assert.equal(gh.calls.length, 2);
  assert.equal(varOf(gh.calls[0], 'q'), 'repo:acme/widgets is:pr is:open');
  assert.deepEqual(prs?.map((p) => p.number), [21180, 21146, 21143]);
  const { fingerprint, ...first } = prs![0];
  assert.deepEqual(first, {
    number: 21180,
    url: 'https://github.com/acme/widgets/pull/21180',
    title: 'PR 21180',
    state: 'OPEN',
    isDraft: false,
    isCrossRepository: false,
    headRefName: 'feature/dispatch-once',
    headRefOid: '64162cf70c22069136ed65f76d13956867d28a9a',
    baseRefName: 'master',
    mergeable: 'MERGEABLE',
    updatedAt: '2026-11-26T15:58:19Z',
    rollupState: 'PENDING',
    reviewDecision: 'REVIEW_REQUIRED',
  });
  assert.match(fingerprint, /^[0-9a-f]{16}$/);
  assert.equal(prs![1].isDraft, true);
});

test('the light fingerprint moves with head, base, mergeability, rollup, review decision, draft state and updatedAt only', () => {
  const pr: Omit<LightPr, 'fingerprint'> = {
    number: 1, url: 'u', title: 't', state: 'OPEN', isDraft: false, isCrossRepository: false, headRefName: 'h', headRefOid: 'a1',
    baseRefName: 'master', mergeable: 'MERGEABLE', updatedAt: '2026-11-26T10:00:00Z', rollupState: 'PENDING', reviewDecision: null,
  };
  const base = lightFingerprint(pr);
  const changes: Partial<LightPr>[] = [
    { headRefOid: 'b2' }, { baseRefName: 'main' }, { mergeable: 'CONFLICTING' }, { rollupState: 'FAILURE' }, { rollupState: null },
    { reviewDecision: 'APPROVED' }, { isDraft: true }, { updatedAt: '2026-11-26T10:00:01Z' },
  ];
  for (const change of changes) assert.notEqual(lightFingerprint({ ...pr, ...change }), base, JSON.stringify(change));
  assert.equal(lightFingerprint({ ...pr, title: 'renamed', url: 'v' }), base);
});

test('the light read is null, never an empty list, when any page cannot be read', async () => {
  const down = fakeGh([[isSearch, { code: 1, stderr: 'gh: HTTP 502: Bad Gateway' }]]);
  assert.equal(await openPrsLight(down.run, repo), null);
  const secondFails = fakeGh([
    [(a) => isSearch(a) && !varOf(a, 'after'), { stdout: fixture('light-page-1.json') }],
    [isSearch, { code: 1, stdout: '{"data":null,"errors":[{"type":"INTERNAL","message":"Something went wrong"}]}' }],
  ]);
  assert.equal(await openPrsLight(secondFails.run, repo), null);
});

function detailGh() {
  return fakeGh([
    [isPage, { stdout: fixture('detail-contexts-page-2.json') }],
    [isChunk, { code: 1, stdout: fixture('detail-chunk.json'), stderr: 'gh: Could not resolve to a PullRequest with the number of 99999.' }],
  ]);
}

const job = (run: number, id: number) => `https://github.com/acme/widgets/actions/runs/${run}/job/${id}`;

test('builds the snapshot the existing helpers build: failing, superseded, pending and hung checks, people-only checks left out', async () => {
  const gh = detailGh();
  const details = await prDetails(gh.run, repo, [21093, 99999]);
  assert.deepEqual([...details!.keys()], [21093]);
  const { snapshot } = details!.get(21093)!;
  assert.equal(snapshot.number, 21093);
  assert.equal(snapshot.state, 'OPEN');
  assert.equal(snapshot.mergeable, 'MERGEABLE');
  assert.equal(snapshot.headRefOid, 'd0d129d17f6c654dbedd9b4e4af4b75e85ce098c');
  assert.deepEqual(snapshot.failingChecks, [
    { name: 'test-unit-shard (1)', url: job(45870000001, 140080000001), workflowName: 'Unit tests (merge queue)' },
  ]);
  assert.deepEqual(snapshot.supersededChecks, [{ name: 'plan', url: job(45870000010, 140080000010), workflowName: 'Terragrunt' }]);
  assert.deepEqual(snapshot.pendingChecks, ['docker_build_ecs', 'stop-timeout']);
  assert.equal(snapshot.finishedChecks, 12);
  assert.deepEqual(snapshot.hungJobs, [{ runId: '45870000020', jobId: '140080000020', name: 'docker_build_ecs', startedAt: '2026-11-26T09:12:50Z' }]);
});

test('reads the second page of check contexts with the PR number for isRequired', async () => {
  const gh = detailGh();
  const { checks } = (await prDetails(gh.run, repo, [21093]))!.get(21093)!;
  const page = gh.calls.filter(isPage);
  assert.equal(page.length, 1);
  assert.equal(varOf(page[0], 'cursor'), 'MTAw');
  assert.equal(varOf(page[0], 'number'), '21093');
  assert.match(queryOf(page[0]), /contexts\(first:100,after:\$cursor\)/);
  assert.match(queryOf(page[0]), /isRequired\(pullRequestNumber:\$number\)/);
  assert.equal(checks.length, 16);
  assert.deepEqual(checks.filter((c) => c.isRequired).map((c) => c.name), ['lint', 'Code review', 'mergefreeze']);
  assert.deepEqual(checks.find((c) => c.name === 'Cursor Bugbot'), {
    name: 'Cursor Bugbot', workflowName: null, conclusion: 'NEUTRAL', status: 'COMPLETED', isRequired: false,
    url: 'https://cursor.com/docs/bugbot', startedAt: '2026-11-26T17:44:48Z', description: 'Bugbot Review',
  });
  assert.deepEqual(humanChecksOf(checks), [
    { name: 'Code review gate', state: 'failing', description: '', url: job(45870000040, 140080000040) },
    { name: 'Code review', state: 'pending', description: 'needs review from @enterprise-billing', url: 'https://github.com/acme/widgets/actions/runs/45871151068' },
  ]);
});

test('drops factory-marked and minimized comments, keeps review bodies as prSnapshot does, and marks bot authors', async () => {
  const { snapshot } = (await prDetails(detailGh().run, repo, [21093]))!.get(21093)!;
  assert.deepEqual(snapshot.comments, [
    {
      author: 'github-actions', authorIsBot: true, body: '## Coverage report\n\n100% of the statement lines added by this PR are covered.',
      createdAt: '2026-11-25T03:11:24Z', url: 'https://github.com/acme/widgets/pull/21093#issuecomment-7151677137',
    },
    { author: 'reviewer', authorIsBot: false, body: 'Can the cron run hourly instead?', createdAt: '2026-11-26T12:05:00Z', url: 'https://github.com/acme/widgets/pull/21093#issuecomment-7190500002' },
  ]);
  assert.deepEqual(snapshot.reviews.map((r) => [r.author, r.authorIsBot, r.state]), [
    ['owner', false, 'COMMENTED'],
    ['cursor', true, 'COMMENTED'],
    ['reviewer', false, 'CHANGES_REQUESTED'],
  ]);
  assert.ok(snapshot.comments.every((c) => !c.body.includes(FACTORY_MARKER)));
});

test('builds the unresolved threads unresolvedThreads() builds', async () => {
  const { threads } = (await prDetails(detailGh().run, repo, [21093]))!.get(21093)!;
  assert.deepEqual(threads, [
    {
      id: 'PRRT_kwDODL90Ac68ghjF', rootCommentId: 4711909470, rootAuthor: 'cursor', rootIsBot: true,
      path: 'service/billing/controllers/workflows/activities/salesforce_renewal_activities.py', line: 41, outdated: false,
      awaitingReviewer: false, lastCommentAt: '2026-11-26T17:50:17Z',
      comments: [{ author: 'cursor', body: '### Retry skip hides incomplete provisioning\n\n**High Severity**\n\nThe retry returns early before the second step runs.' }],
    },
    {
      id: 'PRRT_answered', rootCommentId: 21, rootAuthor: 'reviewer', rootIsBot: false, path: 'b.py', line: null, outdated: true,
      awaitingReviewer: true, lastCommentAt: '2026-11-25T11:00:00Z', comments: [{ author: 'reviewer', body: 'Why a list here?' }],
    },
    {
      id: 'PRRT_ghost', rootCommentId: 31, rootAuthor: 'unknown', rootIsBot: false, path: 'c.py', line: 7, outdated: false,
      awaitingReviewer: false, lastCommentAt: '2026-11-25T12:00:00Z', comments: [{ author: 'unknown', body: 'Rename this.' }],
    },
  ]);
});

test('asks for the details a few PRs per query, numbers passed as variables', async () => {
  const chunk = JSON.parse(fixture('detail-chunk.json'));
  const gh = fakeGh([
    [isPage, { stdout: fixture('detail-contexts-page-2.json') }],
    [isChunk, (args) => {
      const repository = Object.fromEntries(
        args.filter((a) => /^n\d+=/.test(a)).map((a) => {
          const [key, value] = a.split('=');
          return [`pr${key.slice(1)}`, { ...chunk.data.repository.pr0, number: Number(value) }];
        }),
      );
      return { stdout: JSON.stringify({ data: { rateLimit: chunk.data.rateLimit, repository } }) };
    }],
  ]);
  const numbers = [1, 2, 3, 4, 5, 6];
  const details = await prDetails(gh.run, repo, [...numbers, 6]);
  assert.deepEqual([...details!.keys()], numbers);
  const chunks = gh.calls.filter(isChunk);
  assert.deepEqual(chunks.map((args) => args.filter((a) => /^n\d+=/.test(a))), [['n0=1', 'n1=2', 'n2=3', 'n3=4'], ['n0=5', 'n1=6']]);
  assert.match(queryOf(chunks[0]), /\$n3:Int!/);
  assert.match(queryOf(chunks[0]), /isRequired\(pullRequestNumber:\$n3\)/);
  assert.deepEqual([varOf(chunks[0], 'owner'), varOf(chunks[0], 'name')], ['acme', 'widgets']);
});

test('the details are null when GitHub fails, answers with a real error, or a later page fails', async () => {
  const down = fakeGh([[isChunk, { code: 1, stderr: 'gh: HTTP 502' }]]);
  assert.equal(await prDetails(down.run, repo, [21093]), null);
  const broken = fakeGh([[isChunk, { code: 1, stdout: '{"data":{"repository":null},"errors":[{"type":"FORBIDDEN","message":"Resource not accessible"}]}' }]]);
  assert.equal(await prDetails(broken.run, repo, [21093]), null);
  const pageFails = fakeGh([
    [isPage, { code: 1, stderr: 'gh: HTTP 502' }],
    [isChunk, { stdout: fixture('detail-chunk.json') }],
  ]);
  assert.equal(await prDetails(pageFails.run, repo, [21093]), null);
});

test('reads the state of PRs that may have left the open list, merged with their merge commit', async () => {
  const gh = fakeGh([[() => true, {
    stdout: JSON.stringify({
      data: {
        rateLimit: { cost: 1, remaining: 4900, limit: 5000, resetAt: '2026-11-26T20:00:00Z' },
        repository: {
          pr0: { number: 7, state: 'MERGED', isDraft: false, headRefOid: 'a1', baseRefName: 'master', mergeCommit: { oid: 'm1' } },
          pr1: { number: 8, state: 'CLOSED', isDraft: true, headRefOid: 'b2', baseRefName: 'master', mergeCommit: null },
        },
      },
    }),
  }]]);
  const states = await prStates(gh.run, repo, [7, 8]);
  assert.deepEqual(Object.fromEntries(states!), {
    7: { state: 'MERGED', isDraft: false, headRefOid: 'a1', baseRefName: 'master', mergeCommit: 'm1' },
    8: { state: 'CLOSED', isDraft: true, headRefOid: 'b2', baseRefName: 'master', mergeCommit: null },
  });
  assert.match(queryOf(gh.calls[0]), /mergeCommit\{oid\}/);
});

test('the budget refuses calls below 10% of the limit until the reset, and answers again after it', async () => {
  const now = Date.parse('2026-11-26T19:00:00Z');
  githubBudget.note({ remaining: 499, limit: 5000, resetAt: '2026-11-26T19:30:00Z' });
  assert.equal(githubBudget.canSpend(now), false);
  assert.match(githubBudget.reason(now)!, /499 of 5000/);
  assert.equal(githubBudget.canSpend(Date.parse('2026-11-26T19:30:01Z')), true);
  githubBudget.note({ remaining: 500, limit: 5000, resetAt: '2026-11-26T19:30:00Z' });
  assert.equal(githubBudget.canSpend(now), true);
  assert.equal(githubBudget.reason(now), null);
});

test('a refused budget makes no gh call and returns null', async () => {
  githubBudget.note({ remaining: 10, limit: 5000, resetAt: new Date(Date.now() + 60_000).toISOString() });
  const gh = fakeGh([]);
  assert.equal(await openPrsLight(gh.run, repo), null);
  assert.equal(await prDetails(gh.run, repo, [1]), null);
  assert.equal(await prStates(gh.run, repo, [1]), null);
  assert.equal(await failedJobLog(gh.run, job(1, 2)), null);
  assert.equal(gh.calls.length, 0);
  assert.ok(githubBudget.reason());
});

test('rate-limit refusals back off 60 s, doubling to at most 15 minutes, and a success restarts the doubling', () => {
  const t = Date.parse('2026-11-26T19:00:00Z');
  const pausedFor = (from: number) => {
    let ms = 0;
    while (!githubBudget.canSpend(from + ms)) ms += 1000;
    return ms / 1000;
  };
  githubBudget.noteRefusal('gh: Could not resolve to a PullRequest', t);
  assert.equal(githubBudget.canSpend(t), true);
  githubBudget.noteRefusal('gh: HTTP 403: Forbidden', t);
  assert.equal(githubBudget.canSpend(t), true, 'an authorization error does not pause unrelated GitHub reads');
  githubBudget.noteRefusal('gh: You have exceeded a secondary rate limit (HTTP 403)', t);
  assert.equal(pausedFor(t), 60);
  githubBudget.noteRefusal('gh: HTTP 429', t);
  assert.equal(pausedFor(t), 120);
  for (let i = 0; i < 6; i++) githubBudget.noteRefusal('abuse detection mechanism', t);
  assert.equal(pausedFor(t), 900);
  assert.match(githubBudget.reason(t)!, /refused/);
  githubBudget.note({ remaining: 4000, limit: 5000, resetAt: '2026-11-26T20:00:00Z' });
  githubBudget.noteRefusal('gh: HTTP 403: API rate limit exceeded', t + 1_000_000);
  assert.equal(pausedFor(t + 1_000_000), 60);
  githubBudget.reset();
  assert.equal(githubBudget.canSpend(t + 1_000_000), true);
});

test('a GraphQL answer feeds the budget its rate-limit reading', async () => {
  const resetAt = new Date(Date.now() + 60_000).toISOString();
  const low = JSON.stringify({ data: { rateLimit: { cost: 1, remaining: 3, limit: 5000, resetAt }, search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } });
  assert.deepEqual(await openPrsLight(fakeGh([[isSearch, { stdout: low }]]).run, repo), []);
  assert.equal(githubBudget.canSpend(), false);
});

test('keeps what a failed pytest job says, without timestamps, from that job alone', async () => {
  const log = fixture('job-log-pytest.txt');
  const gh = fakeGh([[(a) => a[0] === 'api', { stdout: log }]]);
  const excerpt = await failedJobLog(gh.run, job(45865756979, 140068030099));
  assert.deepEqual(gh.calls, [['api', 'repos/acme/widgets/actions/jobs/140068030099/logs']]);
  const lines = excerpt!.split('\n');
  assert.ok(lines.length <= 150 && Buffer.byteLength(excerpt!) <= 12_000);
  assert.ok(lines.every((l) => !/^\uFEFF?\d{4}-\d\d-\d\dT/.test(l)), 'timestamps stripped');
  assert.ok(lines.includes('=========================== short test summary info ============================'));
  assert.equal(lines.filter((l) => l.startsWith('ERROR  - ImportError')).length, 16);
  assert.equal(lines.at(-1), '##[error]Process completed with exit code 1.');
  assert.ok(!excerpt!.includes('Runner name'), 'setup noise left out');
  assert.ok(!excerpt!.includes('AWS_DEFAULT_REGION'), 'later steps left out');
});

test('keeps the failed pre-commit hook and the lines before the error', () => {
  const log = [
    '2026-11-26T17:50:35.6390114Z Detect secrets.............................................................Passed',
    ...Array.from({ length: 60 }, (_, i) => `2026-11-26T17:50:35.6400000Z noise ${i}`),
    '2026-11-26T17:50:35.6447825Z Generate OpenAPI specs...................................................Failed',
    '2026-11-26T17:50:35.6448412Z - hook id: generate-openapi',
    '2026-11-26T17:50:35.6449591Z - files were modified by this hook',
    ...Array.from({ length: 60 }, (_, i) => `2026-11-26T17:50:35.6450000Z diff ${i}`),
    '2026-11-26T17:50:35.6678637Z ##[error]Process completed with exit code 1.',
  ].join('\n');
  const lines = failureExcerpt(log).split('\n');
  assert.deepEqual(lines.slice(0, 4), [
    'Generate OpenAPI specs...................................................Failed',
    '- hook id: generate-openapi',
    '- files were modified by this hook',
    '…',
  ]);
  assert.equal(lines[4], 'diff 20');
  assert.equal(lines.at(-1), '##[error]Process completed with exit code 1.');
  assert.ok(!lines.some((l) => l.startsWith('noise')));
});

test('caps the excerpt at 150 lines and 12 KB, keeping the error lines, and falls back to the tail with no marker', () => {
  const many = [...Array.from({ length: 400 }, (_, i) => `FAILED tests/test_${i}.py::test_it - AssertionError`), '##[error]Process completed with exit code 1.'].join('\n');
  const capped = failureExcerpt(many).split('\n');
  assert.equal(capped.length, 150);
  assert.equal(capped.at(-1), '##[error]Process completed with exit code 1.');
  const wide = Array.from({ length: 100 }, () => `● ${'x'.repeat(1000)}`).join('\n');
  const narrow = failureExcerpt(wide);
  assert.ok(Buffer.byteLength(narrow) <= 12_000);
  assert.ok(narrow.split('\n').every((l) => l.length <= 401));
  const plain = Array.from({ length: 300 }, (_, i) => `2026-11-26T17:50:35.6400000Z line ${i}`).join('\n');
  const tail = failureExcerpt(plain).split('\n');
  assert.equal(tail.length, 150);
  assert.equal(tail.at(-1), 'line 299');
});

test('reads the failed jobs of the run when the URL names no job, and nothing for other URLs or failures', async () => {
  const runLog = ['test-unit\tRun tests\t2026-11-26T17:14:40.6065164Z FAILED tests/test_a.py::test_b', 'test-unit\tRun tests\t2026-11-26T17:14:44.2433487Z ##[error]Process completed with exit code 1.'].join('\n');
  const gh = fakeGh([[(a) => a[0] === 'run', { stdout: runLog }]]);
  const excerpt = await failedJobLog(gh.run, 'https://github.com/acme/widgets/actions/runs/45865756979');
  assert.deepEqual(gh.calls, [['run', 'view', '45865756979', '--log-failed', '-R', 'acme/widgets']]);
  assert.equal(excerpt, 'FAILED tests/test_a.py::test_b\n##[error]Process completed with exit code 1.');
  assert.equal(await failedJobLog(gh.run, 'https://cursor.com/docs/bugbot'), null);
  assert.equal(await failedJobLog(gh.run, null), null);
  const gone = fakeGh([[() => true, { code: 1, stderr: 'gh: HTTP 410: Gone' }]]);
  assert.equal(await failedJobLog(gone.run, job(1, 2)), null);
});
