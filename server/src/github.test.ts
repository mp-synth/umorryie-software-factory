import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMENT_PREFIX, FACTORY_MARKER, factoryCommentBody } from './github.ts';

test('starts every factory comment with the automation prefix and keeps the loop marker', () => {
  const body = factoryCommentBody('Fixed the lint error.');
  assert.ok(body.includes(FACTORY_MARKER));
  assert.equal(body.split('\n').find((line) => line !== FACTORY_MARKER), COMMENT_PREFIX);
  assert.ok(body.endsWith('Fixed the lint error.'));
});
