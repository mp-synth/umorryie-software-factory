import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TicketStatus } from '@factory/shared';
import { gateTarget, openPrsBelow, getStackDepth, nextStackStep, propagationTargets, sortBottomUp, stackBase, stackChain, stackStepMessage, syncTarget } from './stacks.ts';

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

const member = (key: string, below: string | null, status: TicketStatus, prNumber: number | null, baseRef = below ? `factory/x/${below}` : 'main') => ({
  key,
  dependsOn: below ? [below] : [],
  status,
  branch: `factory/x/${key}`,
  prHeadRef: null,
  baseRef,
  prNumber,
  prState: prNumber ? 'OPEN' : null,
});

test('stackBase is the nearest ticket below that is still open', () => {
  const one = member('01', null, 'approved', 10);
  const two = member('02', '01', 'approved', 11);
  const three = member('03', '02', 'built', 12);
  assert.equal(stackBase(three, [one, two, three]), two);
  assert.equal(stackBase(three, [one, { ...two, status: 'merged' as const }, three]), one);
  assert.equal(stackBase(three, [{ ...one, status: 'merged' as const }, { ...two, status: 'canceled' as const }, three]), null);
  assert.equal(stackBase(one, [one, two, three]), null);
});

test('syncTarget points a PR at the branch of the open PR below it', () => {
  const one = member('01', null, 'approved', 10);
  const three = member('03', '02', 'built', 12, 'factory/x/01');
  const two = member('02', '01', 'approved', 11);
  assert.deepEqual(syncTarget(three, [one, two, three], 'main'), { parent: two, target: 'factory/x/02' });
});

test('syncTarget leaves the bottom of a stack and a PR whose parent has no open PR alone', () => {
  const one = member('01', null, 'approved', 10);
  const two = member('02', '01', 'building', null);
  const three = member('03', '02', 'built', 12);
  assert.equal(syncTarget(one, [one, two, three], 'main'), null);
  assert.equal(syncTarget(three, [one, two, three], 'main'), null);
});

test('syncTarget moves a PR onto the base branch once everything below it merged', () => {
  const one = member('01', null, 'merged', 10);
  const two = member('02', '01', 'approved', 11);
  assert.deepEqual(syncTarget(two, [one, two], 'main'), { parent: null, target: 'main' });
  assert.equal(syncTarget({ ...two, baseRef: 'main' }, [one, two], 'main'), null);
});

test('syncTarget preserves a bottom PR manually retargeted to another branch', () => {
  const retargeted = member('01', null, 'approved', 10, 'release/1.2');
  assert.deepEqual(syncTarget(retargeted, [retargeted], 'main'), { parent: null, target: 'release/1.2' });
  assert.equal(gateTarget(retargeted, [retargeted], 'main'), 'release/1.2');
});

test('reports a sibling that cannot join because another PR already sits on its parent', () => {
  const step = nextStackStep([10, 13], { pr: 10, stack: { number: 99, pullRequests: [10, 11] } });
  assert.deepEqual(step, { kind: 'taken', parent: 10, top: 11 });
  assert.match(stackStepMessage(step, [10, 13])!, /^#13 builds on #10 beside #11, which already sits on top of it in its GitHub stack/);
  assert.match(stackStepMessage(step, [10, 12, 14])!, /^#14 builds on #12, which is outside the GitHub stack of #10, so #14 stays outside it too/);
});

test('makes the stack again from the chain when closed PRs left in it block the line', () => {
  const stack = { number: 99, pullRequests: [20990, 20991, 20993, 20996, 20997], closed: [20996, 20997], merged: [] };
  const step = nextStackStep([20990, 20991, 20993, 20998], { pr: 20993, stack });
  assert.deepEqual(step, { kind: 'restack', stack: 99, prs: [20990, 20991, 20993, 20998], closed: [20996, 20997] });
  assert.equal(
    stackStepMessage(step, [20990, 20991, 20993, 20998]),
    'Made the GitHub stack again as #20990 → #20991 → #20993 → #20998: closed #20996 → #20997 were still in it, so nothing could stack above them.',
  );
});

test('never restacks around a merged PR, a PR outside the chain, or a stack with nothing closed', () => {
  const merged = { number: 99, pullRequests: [10, 11, 12], closed: [12], merged: [10] };
  assert.equal(nextStackStep([10, 11, 13], { pr: 11, stack: merged }).kind, 'taken');
  const foreign = { number: 99, pullRequests: [10, 50, 12], closed: [12], merged: [] };
  assert.equal(nextStackStep([10, 11, 13], { pr: 10, stack: foreign }).kind, 'taken');
  const clean = { number: 99, pullRequests: [10, 11], closed: [], merged: [] };
  assert.equal(nextStackStep([10, 13], { pr: 10, stack: clean }).kind, 'taken');
});

const stacked = (id: string, dependsOn: string[], status: TicketStatus = 'approved') => ({ id, key: id, dependsOn, status });

test('a ticket is as deep as the open tickets below it in its stack', () => {
  const all = [stacked('a', []), stacked('b', ['a']), stacked('c', ['b'], 'built'), stacked('d', ['c'])];
  assert.deepEqual(all.map((t) => getStackDepth(t, all)), [0, 1, 2, 3]);
  const mergedBottom = [stacked('a', [], 'merged'), stacked('b', ['a']), stacked('c', ['b'])];
  assert.deepEqual(mergedBottom.map((t) => getStackDepth(t, mergedBottom)), [0, 0, 1]);
});

test('sorts tickets so the ticket below syncs before the ones on top of it', () => {
  const all = [stacked('top', ['mid']), stacked('mid', ['base']), stacked('side', []), stacked('base', [])];
  assert.deepEqual(sortBottomUp(all, all).map((t) => t.key), ['side', 'base', 'mid', 'top']);
});

test('a handoff waits only for the branches below the first ticket above with work of its own', () => {
  const all = [stacked('src', []), stacked('a', ['src']), stacked('b', ['a']), stacked('c', ['b']), stacked('side', ['src']), stacked('side2', ['side'])];
  const above = all.slice(1);
  const keys = (takingOver: string[]) => propagationTargets(above, all, new Set(takingOver)).map((t) => t.key);
  assert.deepEqual(keys([]), ['a', 'side', 'b', 'side2', 'c']);
  assert.deepEqual(keys(['b']), ['a', 'side', 'side2'], 'b and c wait for the fix on b');
  assert.deepEqual(keys(['a']), ['side', 'side2'], 'another line of the stack is still waited for');
  assert.deepEqual(keys(['src']), ['a', 'side', 'b', 'side2', 'c'], 'work on the source itself takes nothing over');
});

const pr = (key: string, dependsOn: string[], prNumber: number | null, status: TicketStatus = 'approved') => ({
  key,
  id: key,
  dependsOn,
  status,
  branch: `factory/x/${key}`,
  prHeadRef: null,
  baseRef: dependsOn.length ? `factory/x/${dependsOn[0]}` : 'master',
  prNumber,
  prState: prNumber ? 'OPEN' : null,
});

test('the gate merges in the PR below, or the base branch for the bottom PR', () => {
  const all = [pr('a', [], 1), pr('b', ['a'], 2), pr('c', ['b'], null)];
  assert.equal(gateTarget(all[0], all, 'master'), 'master');
  assert.equal(gateTarget(all[1], all, 'master'), 'factory/x/a');
  const unpushed = [pr('a', [], null), pr('b', ['a'], 2)];
  assert.equal(gateTarget(unpushed[1], unpushed, 'master'), null);
});

test('once the PR below merged, the gate merges in the base branch', () => {
  const all = [pr('a', [], 1, 'merged'), pr('b', ['a'], 2)];
  assert.equal(gateTarget(all[1], all, 'master'), 'master');
});

test('lists the open PRs below a ticket lowest first, skipping merged and unpushed ones', () => {
  const all = [pr('a', [], 1, 'merged'), pr('b', ['a'], 2), pr('c', ['b'], null), pr('d', ['c'], 4), pr('e', ['d'], 5)];
  assert.deepEqual(openPrsBelow(all[4], all).map((t) => t.key), ['b', 'd']);
  assert.deepEqual(openPrsBelow(all[1], all), []);
});

test("an adopted PR's gate merges in the branch that PR targets, not the initiative's base", () => {
  const adopted = { ...pr('x', [], 7), prHeadRef: 'someone/feature', baseRef: 'release/1.2' };
  assert.equal(gateTarget(adopted, [adopted], 'master'), 'release/1.2');
});
