import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextStackStep, stackChain, stackStepMessage } from './stacks.ts';

const ticket = (branch: string, baseRef: string, prNumber: number | null, prState: string | null = 'OPEN', prHeadRef: string | null = null) => ({
  branch,
  baseRef,
  prNumber,
  prState,
  prHeadRef,
});

const a = ticket('factory/x/01-a', 'main', 10);
const b = ticket('factory/x/02-b', 'factory/x/01-a', 11);
const c = ticket('factory/x/03-c', 'factory/x/02-b', 12);

test('chains a PR down through every open parent PR it is built on', () => {
  assert.deepEqual(stackChain(c, [a, b, c]), [10, 11, 12]);
  assert.deepEqual(stackChain(b, [a, b, c]), [10, 11]);
});

test('does not stack a PR that targets the base branch or a parent without an open PR', () => {
  assert.equal(stackChain(a, [a, b, c]), null);
  assert.equal(stackChain(b, [{ ...a, prState: 'MERGED' }, b]), null);
  assert.equal(stackChain(b, [{ ...a, prNumber: null }, b]), null);
  assert.equal(stackChain({ ...b, prNumber: null }, [a, b]), null);
});

test("finds an adopted parent PR by its remote branch, not the factory's local one", () => {
  const own = ticket('factory/pr-7', 'main', 7, 'OPEN', 'matej/feature');
  const child = ticket('factory/pr-8', 'matej/feature', 8, 'OPEN', 'matej/feature-2');
  assert.deepEqual(stackChain(child, [own, child]), [7, 8]);
});

test('creates a new stack when no PR in the chain is stacked yet', () => {
  assert.deepEqual(nextStackStep([10, 11, 12], null), { kind: 'create', prs: [10, 11, 12] });
});

test("adds the rest of the chain on top of the parent's stack", () => {
  const step = nextStackStep([10, 11, 12], { pr: 10, stack: { number: 99, pullRequests: [9, 10] } });
  assert.deepEqual(step, { kind: 'add', stack: 99, prs: [11, 12] });
  assert.equal(stackStepMessage(step, [10, 11, 12]), 'Added #11 → #12 to the GitHub stack, on top of #10.');
});

test('leaves a PR that is already in a stack alone', () => {
  const step = nextStackStep([10, 11], { pr: 11, stack: { number: 99, pullRequests: [10, 11] } });
  assert.deepEqual(step, { kind: 'done', stack: 99 });
  assert.equal(stackStepMessage(step, [10, 11]), null);
});

test('reports a sibling that cannot join because another PR already sits on its parent', () => {
  const step = nextStackStep([10, 13], { pr: 10, stack: { number: 99, pullRequests: [10, 11] } });
  assert.deepEqual(step, { kind: 'taken', parent: 10, top: 11 });
  assert.match(stackStepMessage(step, [10, 13])!, /^#13 targets the branch of #10 but can't join its GitHub stack: #11 already sits on top of it/);
});
