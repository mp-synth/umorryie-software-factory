import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentCeiling, agentLimit, localWorkSlots, machinePool, memoryStateFromDarwinLevel, memoryStateFromMeminfo, mostAgentsWithGuarantees, pressureOf, sampleMachine } from './capacity.ts';

const laptop = { cores: 11, memoryGb: 36 };

test('sizes the pool by whichever of cpu and memory runs out first', () => {
  assert.equal(machinePool(laptop), 42);
  assert.equal(machinePool({ cores: 16, memoryGb: 64 }), 64);
  assert.equal(machinePool({ cores: 32, memoryGb: 16 }), 16);
});

test('keeps a small pool on a small machine', () => {
  assert.equal(machinePool({ cores: 2, memoryGb: 4 }), 4);
});

test('fits fifteen initiatives side by side on a developer laptop', () => {
  assert.ok(machinePool(laptop) >= 15 * 2);
});

test('uses the machine pool when auto-scaling and the fixed number otherwise', () => {
  assert.equal(agentCeiling({ autoScaleAgents: true, maxConcurrentAgents: 12 }, laptop), 42);
  assert.equal(agentCeiling({ autoScaleAgents: false, maxConcurrentAgents: 12 }, laptop), 12);
});

test('reads pressure from memory first, then load', () => {
  assert.equal(pressureOf({ loadPerCore: 0.4, memory: 'normal' }), 'ok');
  assert.equal(pressureOf({ loadPerCore: 2, memory: 'normal' }), 'load');
  assert.equal(pressureOf({ loadPerCore: 0.4, memory: 'warning' }), 'memory');
  assert.equal(pressureOf({ loadPerCore: 9, memory: 'critical' }), 'memory');
});

test('opens the whole pool while the machine has room', () => {
  assert.equal(agentLimit({ autoScale: true, ceiling: 42, pressure: 'ok', machine: laptop, lanes: 15 }), 42);
});

test('under pressure keeps one agent per core, and one per initiative when there are more initiatives', () => {
  assert.equal(agentLimit({ autoScale: true, ceiling: 42, pressure: 'load', machine: laptop, lanes: 3 }), 11);
  assert.equal(agentLimit({ autoScale: true, ceiling: 42, pressure: 'memory', machine: laptop, lanes: 15 }), 15);
});

test('never throttles above the pool', () => {
  assert.equal(agentLimit({ autoScale: true, ceiling: 4, pressure: 'load', machine: laptop, lanes: 15 }), 4);
});

test('leaves a fixed limit alone whatever the machine reports', () => {
  assert.equal(agentLimit({ autoScale: false, ceiling: 12, pressure: 'memory', machine: laptop, lanes: 15 }), 12);
});

test('runs one piece of local work per core, and two at least', () => {
  assert.equal(localWorkSlots(laptop), 11);
  assert.equal(localWorkSlots({ cores: 1, memoryGb: 8 }), 2);
});

test('lets guaranteed agents exceed the pool by half of it at most', () => {
  assert.equal(mostAgentsWithGuarantees(42), 63);
  assert.equal(mostAgentsWithGuarantees(5), 7);
});

test('maps the macOS memory pressure level', () => {
  assert.equal(memoryStateFromDarwinLevel('1\n'), 'normal');
  assert.equal(memoryStateFromDarwinLevel('2\n'), 'warning');
  assert.equal(memoryStateFromDarwinLevel('4\n'), 'critical');
  assert.equal(memoryStateFromDarwinLevel('not a number'), 'normal');
});

test('maps available memory on Linux', () => {
  const meminfo = (available: number) => `MemTotal:       1000000 kB\nMemFree:          1000 kB\nMemAvailable:   ${available} kB\n`;
  assert.equal(memoryStateFromMeminfo(meminfo(500000)), 'normal');
  assert.equal(memoryStateFromMeminfo(meminfo(80000)), 'warning');
  assert.equal(memoryStateFromMeminfo(meminfo(20000)), 'critical');
  assert.equal(memoryStateFromMeminfo('garbage'), 'normal');
});

test('samples this machine without throwing and reuses a fresh sample', async () => {
  const first = sampleMachine(1_000_000);
  assert.equal(sampleMachine(1_001_000), first);
  const sample = await first;
  assert.ok(sample.loadPerCore >= 0);
  assert.ok(['normal', 'warning', 'critical'].includes(sample.memory));
});
