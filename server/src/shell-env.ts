import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { ROOT } from './config.ts';

const PATH_MARKER = '__FACTORY_LOGIN_PATH__';
const LOGIN_SHELL_TIMEOUT_MS = 15_000;
const PACKAGE_SCRIPT_RUNNER_VARIABLES = /^(npm_|PNPM_PACKAGE_NAME$|PNPM_SCRIPT_SRC_DIR$|INIT_CWD$|COREPACK_ENABLE_AUTO_PIN$|NODE$)/;
const FRESH_TERMINAL_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

let loginPath: string | null = null;

export function parseLoginPath(stdout: string): string | null {
  const match = stdout.match(new RegExp(`${PATH_MARKER}([^\\n]*?)${PATH_MARKER}`));
  return match?.[1]?.trim() || null;
}

export async function loadLoginShellPath(): Promise<string | null> {
  const shell = process.env.SHELL || '/bin/zsh';
  const r = await promisify(execFile)(shell, ['-lic', `printf '${PATH_MARKER}%s${PATH_MARKER}' "$PATH"`], {
    timeout: LOGIN_SHELL_TIMEOUT_MS,
    env: {
      HOME: os.homedir(),
      USER: os.userInfo().username,
      LOGNAME: os.userInfo().username,
      SHELL: shell,
      LANG: process.env.LANG ?? 'en_US.UTF-8',
      TERM: 'dumb',
      PATH: FRESH_TERMINAL_PATH,
    },
  }).catch((err: { stdout?: string }) => ({ stdout: err.stdout ?? '' }));
  loginPath = parseLoginPath(r.stdout);
  return loginPath;
}

export function withoutFactoryEntries(pathValue: string, factoryRoot: string = ROOT): string {
  return pathValue
    .split(path.delimiter)
    .filter((entry) => entry && path.isAbsolute(entry) && entry !== factoryRoot && !entry.startsWith(`${factoryRoot}${path.sep}`))
    .join(path.delimiter);
}

export function repoShellEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(base).filter(([name]) => !PACKAGE_SCRIPT_RUNNER_VARIABLES.test(name)));
  return { ...env, PATH: loginPath ?? withoutFactoryEntries(base.PATH ?? '') };
}
