import { execFile } from 'node:child_process';

export interface LiveService {
  name: string;
  address: string;
  type: string;
  dev: boolean;
  readOnly: boolean;
}

const SDM_BINARIES = ['sdm', '/Applications/SDM.app/Contents/Resources/sdm.darwin'];
const NON_PRODUCTION_ENV = /^(dev|development|stg|stage|staging|test|qa|sandbox)$/i;
const REFRESH_MS = 60_000;
const SDM_TIMEOUT_MS = 10_000;

let services: LiveService[] = [];

function parseTags(tags: string): Map<string, string> {
  return new Map(
    tags.split(',').map((t) => {
      const eq = t.indexOf('=');
      return eq < 0 ? [t, ''] : [t.slice(0, eq), t.slice(eq + 1)];
    }),
  );
}

// `sdm status` prints one row per resource, columns separated by two or more spaces:
// "☮️ dev: EnactServices: MongoDB (read-only)   connected   127.0.0.1:22000   mongoReplicaSet   db-rw=r,env=dev,…"
export function parseSdmStatus(out: string): LiveService[] {
  const found: LiveService[] = [];
  for (const row of out.split('\n')) {
    const [name, status, address, type, tags = ''] = row.trim().split(/\s{2,}/);
    if (!type || status !== 'connected') continue;
    const tag = parseTags(tags);
    found.push({
      name: name.replace(/^[^\p{L}\p{N}]+/u, ''),
      address,
      type,
      dev: NON_PRODUCTION_ENV.test(tag.get('env') ?? ''),
      readOnly: tag.get('db-rw') === 'r',
    });
  }
  return found;
}

/** The prompt lines that offer agents the read-only dev tunnels and forbid every other connected one. */
export function agentLiveServicesNote(connected: LiveService[] = services): string[] {
  const usable = connected.filter((s) => s.dev && s.readOnly);
  const forbidden = connected.filter((s) => !usable.includes(s));
  const lines: string[] = [];
  if (usable.length) {
    lines.push(
      `Read-only dev services connected on this machine (StrongDM tunnels on localhost, no credentials needed): ${usable.map((s) => `${s.name} at ${s.address} (${s.type})`).join('; ')}.`,
    );
  }
  if (forbidden.length) {
    lines.push(`Never connect to these tunnels (production, read/write or untagged): ${forbidden.map((s) => s.address).join(', ')}.`);
  }
  return lines;
}

function sdmStatus(binaries: string[]): Promise<string | null> {
  const [bin, ...rest] = binaries;
  if (!bin) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(bin, ['status'], { timeout: SDM_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') return resolve(sdmStatus(rest));
      resolve(err ? null : stdout);
    });
  });
}

export async function refreshLiveServices(): Promise<void> {
  const out = await sdmStatus(SDM_BINARIES);
  services = out ? parseSdmStatus(out) : [];
}

export function startLiveServices(): void {
  void refreshLiveServices();
  setInterval(() => void refreshLiveServices(), REFRESH_MS).unref();
}

export function liveServices(): LiveService[] {
  return services;
}
