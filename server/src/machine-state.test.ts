import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { batteryHold, createKeepAwake, parsePmsetBattery } from './machine-state.ts';

class FakeCaffeinate extends EventEmitter {
  killed = false;
  unreferenced = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }

  unref(): void {
    this.unreferenced = true;
  }
}

test('reads the battery level and whether the Mac runs on it', () => {
  const onBattery = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t12%; discharging; 0:31 remaining present: true";
  const charging = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t80%; charging; 1:02 remaining present: true";
  assert.deepEqual(parsePmsetBattery(onBattery), { percent: 12, onBattery: true });
  assert.deepEqual(parsePmsetBattery(charging), { percent: 80, onBattery: false });
  assert.equal(parsePmsetBattery("Now drawing from 'AC Power'"), null);
});

test('holds new agents only on battery below the limit', () => {
  assert.match(batteryHold({ percent: 9, onBattery: true }, 15) ?? '', /9%/);
  assert.equal(batteryHold({ percent: 9, onBattery: false }, 15), null);
  assert.equal(batteryHold({ percent: 40, onBattery: true }, 15), null);
  assert.equal(batteryHold({ percent: 9, onBattery: true }, 0), null);
  assert.equal(batteryHold(null, 15), null);
});

test("an old caffeinate process exiting does not forget its replacement", () => {
  const children: FakeCaffeinate[] = [];
  const keepAwake = createKeepAwake('darwin', () => {
    const child = new FakeCaffeinate();
    children.push(child);
    return child;
  });

  keepAwake(true);
  const old = children[0];
  keepAwake(false);
  keepAwake(true);
  old.emit('exit', 0, null);
  keepAwake(true);

  assert.equal(old.killed, true);
  assert.equal(old.unreferenced, true);
  assert.equal(children.length, 2);
  keepAwake(false);
});
