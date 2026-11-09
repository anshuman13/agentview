import { lazy, Suspense, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { api, setUi, useStore } from '../app/store';
import { findHere, useWorkspace } from '../sessions/folders';
import { setOpened, useOpened } from './opened';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/Button';
import { Menu, MenuItem } from '../ui/Menu';
import { EmptyState } from '../ui/Panel';
import { Row as UiRow } from '../ui/Row';
import { Section } from '../ui/Section';
import { pressable, save, stored } from '../ui/util';
import { touch } from '../app/touch/touch';
import { FileIcon } from './FileIcon';

const FolderPicker = lazy(() => import('../sessions/Sessions').then((m) => ({ default: m.FolderPicker })));

type Entry = { name: string; dir: boolean; hidden: boolean };
type Row = Entry & { path: string; depth: number };

const parentOf = (p: string) => p.slice(0, Math.max(p.lastIndexOf('/'), 0));
const ancestors = (p: string) => p.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'));

export function Explorer() {
  const cwd = useStore((s) => s.session.cwd);
  return <ExplorerView key={cwd} cwd={cwd} />;
}

function ExplorerView({ cwd }: { cwd: string }) {
  const openFile = useStore((s) => s.ui.openFile);
  const recent = useStore((s) => s.recentFiles);
  const opened = useOpened();
  const [picking, setPicking] = useState(false);
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const here = findHere(useWorkspace(cwd).folders, cwd);
  const [dirs, setDirs] = useState<Record<string, Entry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(stored(`explorer.expanded:${cwd}`, [])));
  const [showHidden, setShowHidden] = useState<boolean>(() => stored('explorer.hidden', false));
  const [editorsOpen, setEditorsOpen] = useState<boolean>(() => stored('explorer.editors', true));
  const [sel, setSel] = useState<string | null>(openFile);
  const loading = useRef(new Set<string>());
  const reveal = useRef<string | null>(openFile);
  const tree = useRef<HTMLDivElement>(null);
  const treeId = useId();
  const dirsRef = useRef(dirs);
  dirsRef.current = dirs;

  useEffect(() => save(`explorer.expanded:${cwd}`, [...expanded]), [expanded]);
  useEffect(() => save('explorer.hidden', showHidden), [showHidden]);
  useEffect(() => save('explorer.editors', editorsOpen), [editorsOpen]);

  const fetchDir = (p: string) => {
    loading.current.add(p);
    fetch(api(`/api/dir?path=${encodeURIComponent(p)}`))
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
  const selAt = rows.findIndex((r) => r.path === sel);

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

  const close = (f: string) => {
    const i = opened.indexOf(f);
    const rest = opened.filter((x) => x !== f);
    setOpened(rest);
    if (f === openFile) setUi({ openFile: rest[Math.min(i, rest.length - 1)] ?? null, follow: false });
  };

  return (
    <div className="explorer ex">
      <Section
        label="Open Editors"
        count={opened.length || undefined}
        open={editorsOpen}
        onToggle={() => setEditorsOpen(!editorsOpen)}
        action={opened.length > 0 && <IconButton icon="close-all" label="Close All Editors" size="sm" small onClick={() => { setOpened([]); setUi({ openFile: null, follow: false }); }} />}
      />
      {editorsOpen && (
        <div className="ex-editors">
          {opened.length === 0 && <EmptyState size="sm" title="No open files" hint="Files you open or Claude edits show here" />}
          {opened.map((f) => {
            const name = f.split('/').pop();
            return (
              <UiRow
                key={f}
                plain
                aria-current={f === openFile || undefined}
                data-path={f}
                leading={<FileIcon name={f} />}
                title={<span title={f} className={`ex-name${recent.includes(f) ? ' changed' : ''}`}>{name}</span>}
                meta={parentOf(f)}
                trailing={
                  <IconButton icon="close" label={`Close ${name}`} title="Close" size="sm" small onClick={(e) => {
                    e.stopPropagation();
                    const row = e.currentTarget.closest('.ui-row');
                    ((row?.nextElementSibling ?? row?.previousElementSibling) as HTMLElement | null | undefined)?.focus();
                    close(f);
                  }} />
                }
                {...pressable(() => setUi({ openFile: f, follow: false }))}
              />
            );
          })}
        </div>
      )}
      <Section
        label="Files"
        action={
          <>
            <IconButton ref={more} icon="kebab-vertical" label="More" size="sm" small aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
            {menu && (
              <Menu trigger={more} onClose={() => setMenu(false)}>
                <MenuItem icon="search" onClick={() => { setMenu(false); setUi({ switcherOpen: true }); }}>Go to File{!touch() && <span className="ex-kbd">⌘P</span>}</MenuItem>
                <MenuItem icon={showHidden ? 'eye' : 'eye-closed'} onClick={() => { setMenu(false); setShowHidden(!showHidden); }}>{showHidden ? 'Hide ignored files' : 'Show ignored files'}</MenuItem>
                <MenuItem icon="refresh" onClick={() => { setMenu(false); refresh(); }}>Refresh Explorer</MenuItem>
                <MenuItem icon="collapse-all" onClick={() => { setMenu(false); setExpanded(new Set()); }}>Collapse Folders</MenuItem>
              </Menu>
            )}
          </>
        }
      />
      <UiRow
        className="ex-folder"
        leading={<Icon name={here.tree ? 'git-branch' : 'repo'} small />}
        title={<span title={`${cwd}\nSwitch worktree or chat`}>{here.folder?.name ?? (cwd ? cwd.split('/').pop() : 'Files')}</span>}
        meta={here.label}
        trailing={<Icon name="chevron-down" small />}
        onClick={() => setPicking(true)}
      />
      {picking && <Suspense fallback={null}><FolderPicker onClose={() => setPicking(false)} /></Suspense>}
      <div className="ex-tree" ref={tree} tabIndex={0} role="tree" aria-label="Files" aria-activedescendant={selAt >= 0 ? `${treeId}-${selAt}` : undefined} onKeyDown={onKey}>
        {rows.map((r, i) => {
          const open = r.dir && expanded.has(r.path);
          const changed = !r.dir && recent.includes(r.path);
          return (
            <UiRow
              key={r.path}
              plain
              id={`${treeId}-${i}`}
              role="treeitem"
              aria-level={r.depth + 1}
              aria-expanded={r.dir ? open : undefined}
              aria-selected={r.path === sel}
              data-path={r.path}
              className={r.hidden ? 'ignored' : undefined}
              style={{ paddingLeft: 8 + r.depth * 8 }}
              leading={
                <>
                  <span className="ex-guides">{Array.from({ length: r.depth }, (_, k) => <span key={k} />)}</span>
                  <span className="ex-twistie">
                    {r.dir && <Icon name={open && !dirs[r.path] ? 'loading' : open ? 'chevron-down' : 'chevron-right'} spin={open && !dirs[r.path]} small />}
                  </span>
                  <FileIcon name={r.name} dir={r.dir} open={open} />
                </>
              }
              title={<span title={r.path} className={`ex-name${changed ? ' changed' : ''}`}>{r.name}</span>}
              trailing={changed && <span className="ex-m">M</span>}
              onClick={() => { setSel(r.path); activate(r); }}
            />
          );
        })}
      </div>
    </div>
  );
}
