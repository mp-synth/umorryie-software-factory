import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeNewestFirst, parseReplies, parseRerunIds, planReplies, renderCommentReply, shouldResolve, type PrItems } from './pr-replies.ts';

const fixMd = `FIX: APPLIED

## Summary
- fixed the null check

## Replies
- T1 [VALID]: Added the null check and a test for an empty cart (a1b2c3d).
- **T2** [INVALID]: \`retry()\` already caps attempts at 3 in \`src/retry.ts:41\`.
- C1 [NEEDS-HUMAN]: Whether guests can invite is a product call.
- R1.2 [VALID]: Renamed the helper.
- not a reply line

## Reruns
- 1234567890 (network timeout in an unrelated e2e test)
- 1234567890
`;

const items: PrItems = {
  prNumber: 7,
  threads: [
    { label: 'T1', id: 'PRRT_1', rootCommentId: 11, rootAuthor: 'jane' },
    { label: 'T2', id: 'PRRT_2', rootCommentId: 12, rootAuthor: 'cursor[bot]' },
  ],
  comments: [{ label: 'C1', url: 'https://github.com/o/r/pull/7#issuecomment-1', author: 'bob' }],
};

test('parses one reply per item line and ignores the rest', () => {
  assert.deepEqual(
    parseReplies(fixMd).map((r) => [r.item, r.verdict]),
    [
      ['T1', 'VALID'],
      ['T2', 'INVALID'],
      ['C1', 'NEEDS-HUMAN'],
      ['R1.2', 'VALID'],
    ],
  );
});

test('rerun ids are deduplicated', () => {
  assert.deepEqual(parseRerunIds(fixMd), ['1234567890']);
});

test('threads get their own reply; fixed threads and settled bot threads are resolved', () => {
  const planned = planReplies(parseReplies(fixMd), items);
  assert.deepEqual(
    planned.threadReplies.map((r) => [r.thread.label, r.resolve]),
    [
      ['T1', true],
      ['T2', true],
    ],
  );
});

test('a human thread the fixer disputes or only partly fixes stays open for them', () => {
  for (const verdict of ['INVALID', 'PARTIAL', 'UNCONFIRMED', 'NEEDS-HUMAN']) {
    assert.equal(shouldResolve({ item: 'T1', verdict, body: 'x' }, 'jane'), false, verdict);
  }
  assert.equal(shouldResolve({ item: 'T1', verdict: 'PARTIAL', body: 'x' }, 'cursor[bot]'), false);
});

test('top-level comments are answered in the summary; factory-only items stay off the PR', () => {
  const planned = planReplies(parseReplies(fixMd), items);
  assert.deepEqual(planned.commentReplies.map(renderCommentReply), [
    '- Re @bob (https://github.com/o/r/pull/7#issuecomment-1): Whether guests can invite is a product call.',
  ]);
});

test('without PR items nothing is posted', () => {
  const planned = planReplies(parseReplies(fixMd), null);
  assert.equal(planned.threadReplies.length + planned.commentReplies.length, 0);
});

test('when two fix rounds answer the same thread or comment, only the newest reply is kept', () => {
  const olderItems: PrItems = {
    prNumber: 7,
    threads: [{ label: 'T3', id: 'PRRT_1', rootCommentId: 11, rootAuthor: 'jane' }],
    comments: [
      { label: 'C1', url: 'https://github.com/o/r/pull/7#issuecomment-1', author: 'bob' },
      { label: 'C2', url: 'https://github.com/o/r/pull/7#issuecomment-2', author: 'bob' },
    ],
  };
  const older = planReplies(parseReplies('## Replies\n- T3 [VALID]: old\n- C1 [VALID]: old\n- C2 [VALID]: kept\n'), olderItems);
  const newest = planReplies(parseReplies(fixMd), items);
  const merged = mergeNewestFirst([newest, older]);
  assert.deepEqual(
    merged.threadReplies.map((r) => [r.thread.rootCommentId, r.reply.body.slice(0, 5)]),
    [
      [11, 'Added'],
      [12, '`retr'],
    ],
  );
  assert.deepEqual(
    merged.commentReplies.map((r) => r.reply.body),
    ['Whether guests can invite is a product call.', 'kept'],
  );
});
