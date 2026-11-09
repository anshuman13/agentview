import { lazy, Suspense, useId, useRef, useState } from 'react';
import { setUi, useStore } from '../app/store';
import { findHere, useWorkspace } from '../sessions/folders';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/Button';
import { Menu, MenuItem } from '../ui/Menu';
import { Row as UiRow } from '../ui/Row';
import { Section } from '../ui/Section';
import { touch } from '../app/touch/touch';
import { FileIcon } from './FileIcon';
import { OpenEditors } from './OpenEditors';
import { useFileTree, type Row } from './useFileTree';

const FolderPicker = lazy(() => import('../sessions/FolderPicker').then((m) => ({ default: m.FolderPicker })));

export function Explorer() {
  const cwd = useStore((s) => s.session.cwd);
  return <ExplorerView key={cwd} cwd={cwd} />;
}

type MenuProps = { showHidden: boolean; setShowHidden: (v: boolean) => void; refresh: () => void; collapseAll: () => void };

function FilesMenu({ showHidden, setShowHidden, refresh, collapseAll }: MenuProps) {
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton ref={more} icon="kebab-vertical" label="More" size="sm" small aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
      {menu && (
        <Menu trigger={more} onClose={() => setMenu(false)}>
          <MenuItem icon="search" onClick={() => { setMenu(false); setUi({ switcherOpen: true }); }}>Go to File{!touch() && <span className="ex-kbd">⌘P</span>}</MenuItem>
          <MenuItem icon={showHidden ? 'eye' : 'eye-closed'} onClick={() => { setMenu(false); setShowHidden(!showHidden); }}>{showHidden ? 'Hide ignored files' : 'Show ignored files'}</MenuItem>
          <MenuItem icon="refresh" onClick={() => { setMenu(false); refresh(); }}>Refresh Explorer</MenuItem>
          <MenuItem icon="collapse-all" onClick={() => { setMenu(false); collapseAll(); }}>Collapse Folders</MenuItem>
        </Menu>
      )}
    </>
  );
}

type TreeRowProps = { r: Row; id: string; open: boolean; loading: boolean; changed: boolean; selected: boolean; onClick: () => void };

function TreeRow({ r, id, open, loading, changed, selected, onClick }: TreeRowProps) {
  return (
    <UiRow
      plain
      id={id}
      role="treeitem"
      aria-level={r.depth + 1}
      aria-expanded={r.dir ? open : undefined}
      aria-selected={selected}
      data-path={r.path}
      className={r.hidden ? 'ignored' : undefined}
      style={{ paddingLeft: 8 + r.depth * 8 }}
      leading={
        <>
          <span className="ex-guides">{Array.from({ length: r.depth }, (_, k) => <span key={k} />)}</span>
          <span className="ex-twistie">
            {r.dir && <Icon name={loading ? 'loading' : open ? 'chevron-down' : 'chevron-right'} spin={loading} small />}
          </span>
          <FileIcon name={r.name} dir={r.dir} open={open} />
        </>
      }
      title={<span title={r.path} className={`ex-name${changed ? ' changed' : ''}`}>{r.name}</span>}
      trailing={changed && <span className="ex-m">M</span>}
      onClick={onClick}
    />
  );
}

function ExplorerView({ cwd }: { cwd: string }) {
  const openFile = useStore((s) => s.ui.openFile);
  const recent = useStore((s) => s.recentFiles);
  const [picking, setPicking] = useState(false);
  const here = findHere(useWorkspace(cwd).folders, cwd);
  const treeId = useId();
  const t = useFileTree(cwd, openFile, recent);

  return (
    <div className="explorer ex">
      <OpenEditors />
      <Section label="Files" action={<FilesMenu showHidden={t.showHidden} setShowHidden={t.setShowHidden} refresh={() => t.refresh()} collapseAll={t.collapseAll} />} />
      <UiRow
        className="ex-folder"
        leading={<Icon name={here.tree ? 'git-branch' : 'repo'} small />}
        title={<span title={`${cwd}\nSwitch worktree or chat`}>{here.folder?.name ?? (cwd ? cwd.split('/').pop() : 'Files')}</span>}
        meta={here.label}
        trailing={<Icon name="chevron-down" small />}
        onClick={() => setPicking(true)}
      />
      {picking && <Suspense fallback={null}><FolderPicker onClose={() => setPicking(false)} /></Suspense>}
      <div className="ex-tree" ref={t.tree} tabIndex={0} role="tree" aria-label="Files" aria-activedescendant={t.selAt >= 0 ? `${treeId}-${t.selAt}` : undefined} onKeyDown={t.onKey}>
        {t.rows.map((r, i) => {
          const open = r.dir && t.expanded.has(r.path);
          return <TreeRow key={r.path} r={r} id={`${treeId}-${i}`} open={open} loading={open && !t.dirs[r.path]} changed={!r.dir && recent.includes(r.path)} selected={r.path === t.sel} onClick={() => { t.setSel(r.path); t.activate(r); }} />;
        })}
      </div>
    </div>
  );
}
