import path from 'node:path';
import { watch, type FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';

const IGNORED = /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|\.venv|venv|__pycache__|\.mypy_cache|\.pytest_cache|\.ruff_cache|\.tox)(\/|$)/;

// One recursive watcher per folder, shared by every chat in it and closed with the last one.
const folders = new Map<string, { listeners: Set<(rel: string) => void>; watcher: FSWatcher }>();

export function watchFiles(cwd: string, onChange: (rel: string) => void) {
  let folder = folders.get(cwd);
  if (!folder) {
    const listeners = new Set<(rel: string) => void>();
    const timers = new Map<string, NodeJS.Timeout>();
    const watcher = watch(cwd, { recursive: true }, (_, rel) => {
      if (!rel || IGNORED.test(rel)) return;
      clearTimeout(timers.get(rel));
      timers.set(rel, setTimeout(() => {
        timers.delete(rel);
        stat(path.join(cwd, rel)).then((s) => s.isFile() && listeners.forEach((l) => l(rel))).catch(() => {});
      }, 200));
    }).on('error', (err) => {
      console.error(`watcher: ${String(err)}`);
      watcher.close();
      if (folders.get(cwd)?.watcher === watcher) folders.delete(cwd);
    });
    folder = { listeners, watcher };
    folders.set(cwd, folder);
  }
  const { listeners, watcher } = folder;
  listeners.add(onChange);
  return {
    close() {
      if (!listeners.delete(onChange) || listeners.size) return;
      watcher.close();
      folders.delete(cwd);
    },
  };
}
