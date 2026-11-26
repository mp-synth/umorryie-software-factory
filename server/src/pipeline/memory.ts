import * as repo from '../repo.ts';

export interface RememberedStorage {
  recallPrefix(prefix: string): Promise<Map<string, string>>;
  remember(key: string, value: string | null): Promise<void>;
}

const instances = new Set<Remembered<unknown>>();

export function invalidateRemembered(): void {
  for (const remembered of instances) remembered.invalidate();
}

/**
 * A map the factory keeps across restarts (it restarts often): which conflict a fixer already had, which red
 * CI run was handed over, how often a PR left the merge queue. Reads come from memory after the first load;
 * every write goes to the database at once.
 */
export class Remembered<V> {
  private cache: Map<string, V> | null = null;
  private loading: Promise<Map<string, V>> | null = null;
  private version = 0;

  constructor(
    private readonly prefix: string,
    private readonly storage: RememberedStorage = repo,
  ) {
    instances.add(this as Remembered<unknown>);
  }

  private async all(): Promise<Map<string, V>> {
    if (this.cache) return this.cache;
    if (!this.loading) {
      const version = this.version;
      const loading = this.storage.recallPrefix(`${this.prefix}:`).then(async (rows) => {
        const parsed = new Map([...rows].map(([k, v]) => [k, JSON.parse(v) as V]));
        if (version !== this.version) return this.all();
        this.cache = parsed;
        return parsed;
      });
      this.loading = loading;
      void loading.then(
        () => {
          if (this.loading === loading) this.loading = null;
        },
        () => {
          if (this.loading === loading) this.loading = null;
        },
      );
    }
    return await this.loading;
  }

  async get(key: string): Promise<V | undefined> {
    return (await this.all()).get(key);
  }

  async has(key: string): Promise<boolean> {
    return (await this.all()).has(key);
  }

  async set(key: string, value: V): Promise<void> {
    const cache = await this.all();
    const encoded = JSON.stringify(value);
    await this.storage.remember(`${this.prefix}:${key}`, encoded);
    cache.set(key, value);
  }

  async delete(key: string): Promise<void> {
    const cache = await this.all();
    if (!cache.has(key)) return;
    await this.storage.remember(`${this.prefix}:${key}`, null);
    cache.delete(key);
  }

  async entries(): Promise<[string, V][]> {
    return [...(await this.all())];
  }

  /** Drops the in-process copy after external database cleanup or replacement. */
  invalidate(): void {
    this.version++;
    this.cache = null;
    this.loading = null;
  }
}
