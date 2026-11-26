import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from './config.ts';
import { discardDir, emptyTrash } from './discard.ts';

test('discardDir refuses a path outside its allowed root', async () => {
  const allowed = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-discard-allowed-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-discard-outside-'));
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
  try {
    assert.throws(() => discardDir(outside, allowed), /outside/);
    assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
  } finally {
    await fs.promises.rm(allowed, { recursive: true, force: true });
    await fs.promises.rm(outside, { recursive: true, force: true });
  }
});

test('emptyTrash removes old directories sequentially', async () => {
  const originalHome = config.home;
  const originalRm = fs.promises.rm;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-discard-'));
  const trash = path.join(home, 'trash');
  fs.mkdirSync(path.join(trash, 'one'), { recursive: true });
  fs.mkdirSync(path.join(trash, 'two'), { recursive: true });
  let active = 0;
  let mostActive = 0;
  config.home = home;
  fs.promises.rm = async (...args: Parameters<typeof fs.promises.rm>) => {
    active++;
    mostActive = Math.max(mostActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    try {
      return await originalRm(...args);
    } finally {
      active--;
    }
  };

  try {
    await emptyTrash();
    assert.equal(mostActive, 1);
    assert.deepEqual(fs.readdirSync(trash), []);
  } finally {
    fs.promises.rm = originalRm;
    config.home = originalHome;
    await originalRm(home, { recursive: true, force: true });
  }
});
