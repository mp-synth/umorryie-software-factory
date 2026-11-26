import { spawn } from 'node:child_process';
import { exec } from './git.ts';

export interface Battery {
  percent: number;
  onBattery: boolean;
}

export function parsePmsetBattery(output: string): Battery | null {
  const percent = output.match(/(\d+)%/);
  if (!percent) return null;
  return { percent: Number(percent[1]), onBattery: /Battery Power/.test(output) || /discharging/.test(output) };
}

let lastBattery: { at: number; battery: Battery | null } | null = null;

export async function readBattery(now = Date.now()): Promise<Battery | null> {
  if (process.platform !== 'darwin') return null;
  if (lastBattery && now - lastBattery.at < 60_000) return lastBattery.battery;
  const r = await exec('/usr/bin/pmset', ['-g', 'batt'], { timeoutMs: 5000 });
  const battery = r.code === 0 ? parsePmsetBattery(r.stdout) : null;
  lastBattery = { at: now, battery };
  return battery;
}

/** Why no new agent should start for the battery's sake, or null. */
export function batteryHold(battery: Battery | null, minPercent: number): string | null {
  if (!battery || !minPercent || !battery.onBattery || battery.percent >= minPercent) return null;
  return `the Mac runs on battery at ${battery.percent}% (under ${minPercent}%); running steps finish, new ones wait for power`;
}

interface AwakeChild {
  kill(): boolean;
  once(event: 'error' | 'exit', listener: () => void): unknown;
  unref(): void;
}
type StartAwakeChild = () => AwakeChild;

export function createKeepAwake(platform: NodeJS.Platform, start: StartAwakeChild): (wanted: boolean) => void {
  let caffeinate: AwakeChild | null = null;
  return (wanted) => {
    if (platform !== 'darwin') return;
    if (wanted && !caffeinate) {
      const started = start();
      caffeinate = started;
      const forget = () => {
        if (caffeinate === started) caffeinate = null;
      };
      started.once('error', forget);
      started.once('exit', forget);
      started.unref();
    } else if (!wanted && caffeinate) {
      caffeinate.kill();
      caffeinate = null;
    }
  };
}

const updateKeepAwake = createKeepAwake(process.platform, () =>
  spawn('/usr/bin/caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' }),
);

/** Holds `caffeinate -i` while steps run, so idle sleep never pauses them; releases it when nothing runs. */
export function keepAwake(wanted: boolean): void {
  updateKeepAwake(wanted);
}
