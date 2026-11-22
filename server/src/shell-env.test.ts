import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLoginPath, repoShellEnv, withoutFactoryEntries } from './shell-env.ts';

test('the login PATH is read between markers, ignoring whatever the shell prints around it', () => {
  const stdout = 'Welcome back!\n\x1b[1m__FACTORY_LOGIN_PATH__/Users/me/.asdf/shims:/usr/bin__FACTORY_LOGIN_PATH__\x1b[0m';
  assert.equal(parseLoginPath(stdout), '/Users/me/.asdf/shims:/usr/bin');
  assert.equal(parseLoginPath('no marker here'), null);
});

test("the factory's own node_modules bins and relative entries never reach a repo's commands", () => {
  const polluted = ['./node_modules/.bin', '/srv/factory/node_modules/.bin', '/srv/factory/server/node_modules/.bin', '/Users/me/.asdf/shims', '/usr/bin'].join(':');
  assert.equal(withoutFactoryEntries(polluted, '/srv/factory'), '/Users/me/.asdf/shims:/usr/bin');
});

test('variables a package script runner injects are dropped from repo commands', () => {
  const env = repoShellEnv({ npm_config_user_agent: 'pnpm/9.15.0', PNPM_PACKAGE_NAME: '@factory/server', HOME: '/Users/me', PATH: '/usr/bin' });
  assert.equal(env.npm_config_user_agent, undefined);
  assert.equal(env.PNPM_PACKAGE_NAME, undefined);
  assert.equal(env.HOME, '/Users/me');
});
