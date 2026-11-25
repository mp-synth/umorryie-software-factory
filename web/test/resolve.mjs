import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = new URL('../src/', import.meta.url);
const CANDIDATES = ['.ts', '.tsx', '/index.ts'];

export async function resolve(specifier, context, next) {
  const local = specifier.startsWith('@/')
    ? new URL(specifier.slice(2), SRC).href
    : /^\.\.?\//.test(specifier) && context.parentURL
      ? new URL(specifier, context.parentURL).href
      : null;
  if (local && !/\.[cm]?[jt]sx?$/.test(local)) {
    const found = CANDIDATES.map((ext) => local + ext).find((url) => existsSync(fileURLToPath(url)));
    if (found) return next(found, context);
  }
  return next(local ?? specifier, context);
}
