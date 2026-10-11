import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { api, setUi, useStore } from '../store';
import { FolderPicker, findHere, useWorkspace } from './Sessions';
import { Icon } from '../Icon';

type Node = { name: string; path: string; children?: Map<string, Node> };

function buildTree(files: string[]): Node {
  const root: Node = { name: '', path: '', children: new Map() };
  for (const f of files) {
    const parts = f.split('/');
    let cur = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/');
      let next = cur.children!.get(part);
      if (!next) {
        next = i === parts.length - 1 ? { name: part, path } : { name: part, path, children: new Map() };
        cur.children!.set(part, next);
      }
      cur = next;
    });
  }
  return root;
}

function sorted(nodes: Iterable<Node>) {
  return [...nodes].sort((a, b) => {
    if (!!a.children !== !!b.children) return a.children ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function Explorer() {
  const openFile = useStore((s) => s.ui.openFile);
  const recent = useStore((s) => s.recentFiles);
  const cwd = useStore((s) => s.session.cwd);
  const id = useStore((s) => s.session.id);
  const [files, setFiles] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const here = findHere(useWorkspace(cwd).folders, cwd);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(api('/api/files')).then((r) => r.json()).then(setFiles);
  }, [recent.length, id]);

  useEffect(() => {
    if (!openFile) return;
    const parts = openFile.split('/');
    setExpanded((prev) => {
      const next = new Set(prev);
      for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join('/'));
      return next;
    });
  }, [openFile]);

  const tree = useMemo(() => buildTree(files), [files]);
  const toggle = (p: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });

  const rows: ReactElement[] = [];
  const walk = (node: Node, depth: number) => {
    for (const child of sorted(node.children!.values())) {
      const isDir = !!child.children;
      const open = expanded.has(child.path);
      rows.push(
        <div
          key={child.path}
          className={`row ${child.path === openFile ? 'selected' : ''} ${recent.includes(child.path) ? 'changed' : ''}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => (isDir ? toggle(child.path) : setUi({ openFile: child.path, follow: false }))}
          title={child.path}
        >
          <span className="twistie">{isDir && <Icon name={open ? 'chevron-down' : 'chevron-right'} small />}</span>
          <Icon name={isDir ? (open ? 'folder-opened' : 'folder') : 'file'} small />
          <span className="name">{child.name}</span>
          {!isDir && recent.includes(child.path) && <span className="m">M</span>}
        </div>,
      );
      if (isDir && open) walk(child, depth + 1);
    }
  };
  walk(tree, 0);

  return (
    <div className="explorer">
      <button className="folder-switch" title={`${cwd}\nSwitch worktree or chat`} onClick={() => setPicking(true)}>
        <Icon name={here.tree ? 'git-branch' : 'repo'} small />
        <span className="folder-name">{here.folder?.name ?? (cwd ? cwd.split('/').pop() : 'Files')}</span>
        <span className="folder-branch">{here.label}</span>
        <Icon name="chevron-down" small />
      </button>
      {picking && <FolderPicker onClose={() => setPicking(false)} />}
      <div className="tree">{rows}</div>
    </div>
  );
}
