import assert from 'node:assert/strict';
import { test } from 'node:test';
import { databaseLabel, lockHeldMessage, retake } from './server-lock.ts';

function attemptsThat(...outcomes: (boolean | Error)[]): { attempt: () => Promise<boolean>; left: () => number } {
  const queue = [...outcomes];
  return {
    attempt: async () => {
      const outcome = queue.shift();
      if (outcome === undefined) throw new Error('no attempt was expected any more');
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    left: () => queue.length,
  };
}

function countedPause(): { pause: () => Promise<void>; count: () => number } {
  let pauses = 0;
  return {
    pause: async () => {
      pauses += 1;
    },
    count: () => pauses,
  };
}

test('the database is named by its name and host, never with its credentials', () => {
  assert.equal(databaseLabel('postgres://factory:s3cret@127.0.0.1:54329/factory'), 'factory on 127.0.0.1:54329');
  assert.equal(databaseLabel('postgres://factory@db.internal/my%20factory?sslmode=require'), 'my factory on db.internal');
});

test('a second server is told which database is taken and what to do about it', () => {
  const message = lockHeldMessage('postgres://factory:s3cret@127.0.0.1:54329/factory');
  assert.match(message, /^Another factory server is already running on this database \(factory on 127\.0\.0\.1:54329\)\./);
  assert.doesNotMatch(message, /s3cret/);
  assert.doesNotMatch(message, /\n/);
});

test('a dropped lock is taken again as soon as the database answers', async () => {
  const { attempt, left } = attemptsThat(new Error('ECONNREFUSED'), new Error('ECONNREFUSED'), true);
  const { pause, count } = countedPause();
  assert.equal(await retake(attempt, pause), true);
  assert.equal(count(), 2);
  assert.equal(left(), 0);
});

test('a dropped lock that another server took in the meantime is reported as lost at once', async () => {
  const { attempt, left } = attemptsThat(new Error('ECONNRESET'), false, true);
  const { pause, count } = countedPause();
  assert.equal(await retake(attempt, pause), false);
  assert.equal(count(), 1);
  assert.equal(left(), 1);
});

test('taking a dropped lock again ends when the pause is cut short by a shutdown', async () => {
  const { attempt } = attemptsThat(new Error('ECONNREFUSED'));
  await assert.rejects(
    retake(attempt, async () => {
      throw new Error('released');
    }),
    /released/,
  );
});
