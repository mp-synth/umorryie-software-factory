import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { promisify } from 'node:util';
import type { AppSettings, MachinePressure } from '@factory/shared';

export interface Machine {
  cores: number;
  memoryGb: number;
}

export type MemoryState = 'normal' | 'warning' | 'critical';

export interface MachineSample {
  loadPerCore: number;
  memory: MemoryState;
}

const AGENTS_PER_CORE = 4;
const GB_PER_AGENT = 0.75;
const GB_LEFT_FOR_EVERYTHING_ELSE = 4;
const SMALLEST_POOL = 4;
const OVERSUBSCRIBED_LOAD_PER_CORE = 2;
const LOW_AVAILABLE_MEMORY = 0.1;
const CRITICAL_AVAILABLE_MEMORY = 0.05;
const SAMPLE_TTL_MS = 5000;
const BYTES_PER_GB = 1024 ** 3;

export function machinePool({ cores, memoryGb }: Machine): number {
  const byCpu = cores * AGENTS_PER_CORE;
  const byMemory = Math.floor((memoryGb - GB_LEFT_FOR_EVERYTHING_ELSE) / GB_PER_AGENT);
  return Math.max(SMALLEST_POOL, Math.min(byCpu, byMemory));
}

export function localWorkSlots({ cores }: Machine): number {
  return Math.max(2, cores);
}

export const GUARANTEED_AGENTS_PER_INITIATIVE = 1;

export function mostAgentsWithGuarantees(ceiling: number): number {
  return ceiling + Math.floor(ceiling / 2);
}

export function pressureOf(sample: MachineSample): MachinePressure {
  if (sample.memory !== 'normal') return 'memory';
  return sample.loadPerCore >= OVERSUBSCRIBED_LOAD_PER_CORE ? 'load' : 'ok';
}

export function agentCeiling(settings: Pick<AppSettings, 'autoScaleAgents' | 'maxConcurrentAgents'>, machine: Machine): number {
  return settings.autoScaleAgents ? machinePool(machine) : settings.maxConcurrentAgents;
}

export function agentLimit(opts: { autoScale: boolean; ceiling: number; pressure: MachinePressure; machine: Machine; lanes: number }): number {
  if (!opts.autoScale || opts.pressure === 'ok') return opts.ceiling;
  const oneAgentPerLaneAndCore = Math.max(opts.machine.cores, opts.lanes);
  return Math.min(opts.ceiling, oneAgentPerLaneAndCore);
}

export function thisMachine(): Machine {
  return { cores: os.availableParallelism(), memoryGb: Math.round((os.totalmem() / BYTES_PER_GB) * 10) / 10 };
}

export function memoryStateFromDarwinLevel(level: string): MemoryState {
  const normal = 1;
  const warning = 2;
  const n = Number(level.trim());
  if (!Number.isFinite(n) || n <= normal) return 'normal';
  return n <= warning ? 'warning' : 'critical';
}

export function memoryStateFromMeminfo(meminfo: string): MemoryState {
  const kb = (name: string) => Number(meminfo.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'))?.[1]);
  const available = kb('MemAvailable') / kb('MemTotal');
  if (!Number.isFinite(available)) return 'normal';
  if (available < CRITICAL_AVAILABLE_MEMORY) return 'critical';
  return available < LOW_AVAILABLE_MEMORY ? 'warning' : 'normal';
}

async function memoryState(): Promise<MemoryState> {
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await promisify(execFile)('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { timeout: 2000 });
      return memoryStateFromDarwinLevel(stdout);
    }
    if (process.platform === 'linux') return memoryStateFromMeminfo(await fs.promises.readFile('/proc/meminfo', 'utf8'));
  } catch {
    return 'normal';
  }
  return 'normal';
}

let lastSample: { at: number; sample: Promise<MachineSample> } | null = null;

export function sampleMachine(now = Date.now()): Promise<MachineSample> {
  if (lastSample && now - lastSample.at < SAMPLE_TTL_MS) return lastSample.sample;
  const sample = memoryState().then((memory) => ({
    loadPerCore: Math.round((os.loadavg()[0] / os.availableParallelism()) * 100) / 100,
    memory,
  }));
  lastSample = { at: now, sample };
  return sample;
}
