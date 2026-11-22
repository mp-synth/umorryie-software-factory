import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

const databaseUrl = process.env.DATABASE_URL ?? `postgres://factory@127.0.0.1:${process.env.POSTGRES_PORT ?? 54329}/factory`;

export const config = {
  port: Number(process.env.PORT ?? 4317),
  host: process.env.HOST ?? '127.0.0.1',
  databaseUrl,
  home: path.resolve(expandHome(process.env.FACTORY_HOME ?? '~/.software-factory')),
  claudeBin: process.env.CLAUDE_BIN ?? null,
  stopAgentsOnExit: process.env.FACTORY_STOP_AGENTS_ON_EXIT === '1',
  agentsDir: path.join(ROOT, 'agents'),
  migrationsDir: path.join(ROOT, 'server', 'migrations'),
  webDist: path.join(ROOT, 'web', 'dist'),
  production: process.env.NODE_ENV === 'production',
};

fs.mkdirSync(config.home, { recursive: true });
