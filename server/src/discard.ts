import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.ts';

const trashDir = () => path.join(config.home, 'trash');

/**
 * Removes a directory without blocking the server: it is renamed into the trash at once (so its path is free
 * again) and deleted in the background. A worktree of a large repo holds tens of thousands of files.
 */
export function discardDir(dir: string, allowedRoot?: string): void {
  if (!fs.existsSync(dir)) return;
  const roots = (allowedRoot ? [allowedRoot] : [config.home, os.tmpdir()]).map((root) => fs.realpathSync(root));
  const resolved = fs.realpathSync(dir);
  if (!roots.some((root) => resolved !== root && resolved.startsWith(`${root}${path.sep}`))) {
    throw new Error(`refusing to discard ${dir}: it is outside the factory home and temporary directory`);
  }
  const target = path.join(trashDir(), `${path.basename(dir)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    fs.mkdirSync(trashDir(), { recursive: true });
    fs.renameSync(dir, target);
  } catch {
    // The path must be free when this returns, whatever it costs: the caller may create it again at once.
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  }
  void fs.promises.rm(target, { recursive: true, force: true }).catch((err) => console.warn('[discard]', `${target}: ${(err as Error).message}`));
}

/** Deletes what an earlier server left in the trash when it stopped mid-delete. */
export async function emptyTrash(): Promise<void> {
  if (!fs.existsSync(trashDir())) return;
  for (const name of fs.readdirSync(trashDir())) {
    await fs.promises.rm(path.join(trashDir(), name), { recursive: true, force: true }).catch(() => undefined);
  }
}
