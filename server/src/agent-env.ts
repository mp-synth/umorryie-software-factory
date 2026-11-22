import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

export type Redact = (text: string) => string;

export interface AgentEnvironment {
  vars: Record<string, string>;
  secretNames: string[];
  redact: Redact;
}

const NEVER_INJECTED =
  /^(ANTHROPIC_|CLAUDE|MCP_|OTEL_|NODE_|NPM_CONFIG_|GIT_|GH_|GITHUB_TOKEN$|SSH_|PATH$|HOME$|SHELL$|USER$|LOGNAME$|TMPDIR$|PWD$|TERM|LANG$|LC_|DEBUG$|FACTORY_|(HTTP|HTTPS|ALL|NO)_PROXY$)/i;
const BEDROCK_AUTH = /^AWS_/i;
const VERTEX_AUTH = /^(GOOGLE_|GCLOUD_|CLOUDSDK_)/i;
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|PRIVATE|CREDENTIAL|AUTH|DSN|SALT|SIGNATURE|COOKIE|SESSION)/i;
const URL_WITH_CREDENTIALS = /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i;
const MIN_SECRET_LENGTH = 8;
const OPAQUE_VALUE_LENGTH = 24;

export function isEnvFile(file: string): boolean {
  const name = path.basename(file);
  return name === '.env' || name.startsWith('.env.') || name.endsWith('.env');
}

export function looksSecret(name: string, value: string): boolean {
  if (value.length < MIN_SECRET_LENGTH) return false;
  if (SECRET_NAME.test(name) || URL_WITH_CREDENTIALS.test(value)) return true;
  return value.length >= OPAQUE_VALUE_LENGTH && !/\s/.test(value) && !/^([a-z][a-z0-9+.-]*:\/\/|\/|\.|~)/i.test(value);
}

export function readEnvFiles(repoPath: string, files: string[]): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const file of files.filter(isEnvFile)) {
    const full = path.join(repoPath, file);
    if (fs.existsSync(full)) Object.assign(vars, parseEnv(fs.readFileSync(full, 'utf8')));
  }
  return vars;
}

function blockedNames(parentEnv: NodeJS.ProcessEnv): RegExp[] {
  return [NEVER_INJECTED, ...(parentEnv.CLAUDE_CODE_USE_BEDROCK ? [BEDROCK_AUTH] : []), ...(parentEnv.CLAUDE_CODE_USE_VERTEX ? [VERTEX_AUTH] : [])];
}

export function redactor(secrets: [name: string, value: string][]): Redact {
  const longestFirst = [...secrets].sort((a, b) => b[1].length - a[1].length);
  if (!longestFirst.length) return (text) => text;
  return (text) => longestFirst.reduce((out, [name, value]) => (out.includes(value) ? out.split(value).join(`[redacted ${name}]`) : out), text);
}

export function redactDeep<T>(value: T, redact: Redact): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, redact)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v, redact)])) as T;
  }
  return value;
}

export function agentEnvironment(repoPath: string, copyFiles: string[], parentEnv: NodeJS.ProcessEnv = process.env): AgentEnvironment {
  const loaded = readEnvFiles(repoPath, copyFiles);
  const blocked = blockedNames(parentEnv);
  const vars = Object.fromEntries(Object.entries(loaded).filter(([name]) => !blocked.some((b) => b.test(name))));
  const secrets = Object.entries(loaded).filter(([name, value]) => looksSecret(name, value));
  return { vars, secretNames: secrets.map(([name]) => name), redact: redactor(secrets) };
}
