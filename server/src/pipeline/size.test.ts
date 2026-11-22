import assert from 'node:assert/strict';
import { test } from 'node:test';
import { overSizeBudget } from '@factory/shared';
import { sizeNote } from './size.ts';

test('overSizeBudget is true only above 1.5 times the budget', () => {
  assert.equal(overSizeBudget('S', 300), false);
  assert.equal(overSizeBudget('S', 301), true);
  assert.equal(overSizeBudget('XS', 76), true);
  assert.equal(overSizeBudget('M', 750), false);
});

test('overSizeBudget is false without a size, a count or a known size', () => {
  assert.equal(overSizeBudget(null, 900), false);
  assert.equal(overSizeBudget('S', null), false);
  assert.equal(overSizeBudget('S', undefined), false);
  assert.equal(overSizeBudget('L', 900), false);
});

test('sizeNote appears only when over budget', () => {
  assert.equal(sizeNote('S', 340), '340 lines changed outside tests, lockfiles and generated files; the plan sized this S (about 200)');
  assert.equal(sizeNote('S', 120), null);
  assert.equal(sizeNote(null, 900), null);
});
