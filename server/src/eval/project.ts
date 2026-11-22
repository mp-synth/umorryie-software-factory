export const CHECKS_COMMAND = 'node --check src/*.js';

export const BASE_FILES: Record<string, string> = {
  'package.json': `{
  "name": "tally",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
`,
  'README.md': `# Tally

A tiny dependency-free library for a small shop: an in-memory store, pagination,
role checks, text and money helpers, and request handlers built on them.

Run the tests with \`npm test\`.
`,
  'AGENTS.md': `# Conventions

- Every handler in \`src/handlers.js\` calls \`requireRole\` before it touches the store.
- Store calls are async: always \`await\` them, never fire and forget.
- Every module in \`src/\` has a test file in \`test/\` that uses \`node:test\`. Never skip, delete or loosen an assertion to get a test green.
`,
  'src/store.js': `export function createStore() {
  const rows = new Map();
  return {
    async save(id, value) {
      rows.set(id, { ...value });
      return id;
    },
    async get(id) {
      return rows.has(id) ? { ...rows.get(id) } : null;
    },
    async list() {
      return [...rows.values()].map((row) => ({ ...row }));
    },
  };
}
`,
  'src/pagination.js': `export function paginate(items, page, pageSize) {
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page,
    pageSize,
    totalPages: Math.ceil(items.length / pageSize),
  };
}
`,
  'src/auth.js': `export function requireRole(req, role) {
  if (!req.user || !req.user.roles.includes(role)) {
    const error = new Error('forbidden');
    error.status = 403;
    throw error;
  }
}
`,
  'src/text.js': `export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
`,
  'src/money.js': `export function toDollars(cents) {
  return (cents / 100).toFixed(2);
}
`,
  'src/handlers.js': `import { requireRole } from './auth.js';
import { paginate } from './pagination.js';

export async function listItems(req, store) {
  requireRole(req, 'member');
  const items = await store.list();
  return paginate(items, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 10));
}
`,
  'test/store.test.js': `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStore } from '../src/store.js';

test('save then get returns a copy of the value', async () => {
  const store = createStore();
  await store.save('a', { name: 'first' });
  assert.deepEqual(await store.get('a'), { name: 'first' });
});

test('get returns null for an unknown id', async () => {
  assert.equal(await createStore().get('missing'), null);
});
`,
  'test/pagination.test.js': `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paginate } from '../src/pagination.js';

test('paginate returns the requested page', () => {
  const page = paginate([1, 2, 3, 4, 5], 2, 2);
  assert.deepEqual(page.items, [3, 4]);
  assert.equal(page.totalPages, 3);
});

test('paginate returns no items past the end', () => {
  assert.deepEqual(paginate([1, 2, 3], 9, 2).items, []);
});
`,
  'test/auth.test.js': `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireRole } from '../src/auth.js';

test('requireRole passes for a user with the role', () => {
  requireRole({ user: { roles: ['member'] } }, 'member');
});

test('requireRole throws 403 for a user without the role', () => {
  assert.throws(() => requireRole({ user: { roles: ['member'] } }, 'admin'), { status: 403 });
});
`,
  'test/text.test.js': `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slugify } from '../src/text.js';

test('slugify lowercases and joins words', () => {
  assert.equal(slugify('  Hello, World!  '), 'hello-world');
});
`,
  'test/money.test.js': `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toDollars } from '../src/money.js';

test('toDollars formats cents with two decimals', () => {
  assert.equal(toDollars(1999), '19.99');
  assert.equal(toDollars(5), '0.05');
});
`,
  'test/handlers.test.js': `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listItems } from '../src/handlers.js';
import { createStore } from '../src/store.js';

const member = { user: { roles: ['member'] }, query: {} };

test('listItems returns the first page', async () => {
  const store = createStore();
  await store.save('a', { name: 'a' });
  const page = await listItems(member, store);
  assert.equal(page.items.length, 1);
});

test('listItems rejects anonymous callers', async () => {
  await assert.rejects(() => listItems({ query: {} }, createStore()), { status: 403 });
});
`,
};
