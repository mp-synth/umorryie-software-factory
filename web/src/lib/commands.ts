export interface Searchable {
  group: string;
  label: string;
  keywords?: string;
}

/** How well an item matches: 4 its label is the query, 3 its label starts with it, 2 a word does, 1 it only contains it. */
function score(item: Searchable, query: string, words: string[]): number {
  const label = item.label.toLowerCase();
  const haystack = `${label} ${item.keywords ?? ''} ${item.group}`.toLowerCase();
  if (!words.every((w) => haystack.includes(w))) return -1;
  if (label === query) return 4;
  if (label.startsWith(words[0])) return 3;
  if (label.split(/[\s·/-]+/).some((part) => part.startsWith(words[0]))) return 2;
  return 1;
}

/**
 * Commands whose label, keywords or group contain every word of the query. Groups with the best
 * match come first, then the best matches within each group. With no query, each group shows its
 * first `idle` items in the order given.
 */
export function filterCommands<T extends Searchable>(items: T[], query: string, idle = 6): T[] {
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const groups = [...new Set(items.map((i) => i.group))];
  if (!words.length) return groups.flatMap((g) => items.filter((i) => i.group === g).slice(0, idle));
  const scored = items.map((item, order) => ({ item, order, s: score(item, q, words) })).filter((x) => x.s >= 0);
  const best = (g: string) => Math.max(-1, ...scored.filter((x) => x.item.group === g).map((x) => x.s));
  return groups
    .map((g, order) => ({ g, order, best: best(g) }))
    .sort((a, b) => b.best - a.best || a.order - b.order)
    .flatMap(({ g }) =>
      scored
        .filter((x) => x.item.group === g)
        .sort((a, b) => b.s - a.s || a.order - b.order)
        .map((x) => x.item),
    );
}
