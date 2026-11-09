import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { setUi } from '../app/store';
import { listDir } from './fileApi';
import { save, stored } from '../ui/util';

export type Entry = { name: string; dir: boolean; hidden: boolean };
export type Row = Entry & { path: string; depth: number };

export const parentOf = (p: string) => p.slice(0, Math.max(p.lastIndexOf('/'), 0));
const ancestors = (p: string) => p.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'));

// The folders loaded so far, which are expanded, and the keyboard selection in the visible rows.
export function useFileTree(cwd: string, openFile: string | null, recent: string[]) {
  const [dirs, setDirs] = useState<Record<string, Entry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(stored(`explorer.expanded:${cwd}`, [])));
  const [showHidden, setShowHidden] = useState<boolean>(() => stored('explorer.hidden', false));
  const [sel, setSel] = useState<string | null>(openFile);
  const loading = useRef(new Set<string>());
  const reveal = useRef<string | null>(openFile);
  const tree = useRef<HTMLDivElement>(null);
  const dirsRef = useRef(dirs);
  dirsRef.current = dirs;

  useEffect(() => save(`explorer.expanded:${cwd}`, [...expanded]), [expanded]);
  useEffect(() => save('explorer.hidden', showHidden), [showHidden]);

  const fetchDir = (p: string) => {
    loading.current.add(p);
    listDir(p)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((list: Entry[] | null) => {
        loading.current.delete(p);
        if (list) setDirs((d) => ({ ...d, [p]: list }));
      });
  };
  const refresh = (paths = Object.keys(dirsRef.current)) => paths.forEach(fetchDir);

  const rows: Row[] = [];
  const missing: string[] = [];
  const walk = (p: string, depth: number) => {
    const list = dirs[p];
    if (!list) return void missing.push(p);
    for (const e of list) {
      if (e.hidden && !showHidden) continue;
      const path = p ? `${p}/${e.name}` : e.name;
      rows.push({ ...e, path, depth });
      if (e.dir && expanded.has(path)) walk(path, depth + 1);
    }
  };
  walk('', 0);

  useEffect(() => {
    if (cwd) missing.filter((p) => !loading.current.has(p)).forEach(fetchDir);
  }, [cwd, missing.join('\n')]);

  useEffect(() => {
    if (recent[0]) refresh(['', ...ancestors(recent[0])].filter((p) => dirsRef.current[p]));
  }, [recent[0]]);

  useEffect(() => {
    if (!openFile) return;
    setSel(openFile);
    reveal.current = openFile;
    setExpanded((prev) => (ancestors(openFile).every((a) => prev.has(a)) ? prev : new Set([...prev, ...ancestors(openFile)])));
  }, [openFile]);

  useEffect(() => {
    if (!reveal.current) return;
    const el = tree.current?.querySelector(`[data-path="${CSS.escape(reveal.current)}"]`);
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
      reveal.current = null;
    }
  });

  const toggle = (p: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  const activate = (r: Row) => (r.dir ? toggle(r.path) : setUi({ openFile: r.path, follow: false }));
  const go = (r?: Row) => {
    if (!r) return;
    setSel(r.path);
    reveal.current = r.path;
  };

  const onKey = (e: KeyboardEvent) => {
    const i = rows.findIndex((r) => r.path === sel);
    const r = rows[i];
    const open = r?.dir && expanded.has(r.path);
    if (e.key === 'ArrowDown') go(rows[i + 1]);
    else if (e.key === 'ArrowUp') go(rows[Math.max(i - 1, 0)]);
    else if (e.key === 'ArrowRight' && r?.dir) open ? (rows[i + 1]?.depth ?? 0) > r.depth && go(rows[i + 1]) : toggle(r.path);
    else if (e.key === 'ArrowLeft' && r) open ? toggle(r.path) : go(rows.find((x) => x.path === parentOf(r.path)));
    else if (e.key === 'Enter' && r) activate(r);
    else return;
    e.preventDefault();
  };

  return { rows, dirs, expanded, showHidden, setShowHidden, sel, setSel, selAt: rows.findIndex((r) => r.path === sel), tree, refresh, collapseAll: () => setExpanded(new Set()), activate, onKey };
}
