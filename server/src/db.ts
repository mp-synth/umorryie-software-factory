import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { config } from './config.ts';

// Column names map snake_case <-> camelCase. JSON values are left untouched on
// purpose: plan.json keeps the planner's snake_case keys.
export const sql = postgres(config.databaseUrl, {
  max: 10,
  onnotice: () => {},
  transform: { column: { from: postgres.toCamel, to: postgres.fromCamel }, undefined: null },
});

export type Sql = typeof sql;

export function json(value: unknown) {
  return sql.json(value as Parameters<typeof sql.json>[0]);
}

export async function migrate(): Promise<void> {
  await sql`create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql<{ name: string }[]>`select name from _migrations`).map((r) => r.name));
  const files = fs
    .readdirSync(config.migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = fs.readFileSync(path.join(config.migrationsDir, file), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into _migrations (name) values (${file})`;
    });
    console.log(`[db] applied ${file}`);
  }
}
