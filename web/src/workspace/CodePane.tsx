import { Component, Fragment, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { EditorView } from '@codemirror/view';
import { api, setUi, useStore } from '../app/store';
import { fileRequest } from './fileApi';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/Button';
import { Menu, MenuItem } from '../ui/Menu';
import { useSlot } from '../ui/util';
import { FileIcon } from './FileIcon';
import { getOpened, getOpenedChat, setOpened, setOpenedChat } from './opened';
import type { FileData } from './Editor';
import '../styles/features/code.css';

const Editor = lazy(() => import('./Editor').then((m) => ({ default: m.Editor })));
const MarkdownDoc = lazy(() => import('./MarkdownDoc').then((m) => ({ default: m.MarkdownDoc })));

function useFile(path: string | null, bump: unknown, paused = false) {
  const [file, setFile] = useState<FileData | null>(null);
  const [tick, setTick] = useState(0);
  const hold = useRef(paused);
  hold.current = paused;
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && !hold.current) setTick((n) => n + 1);
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  useEffect(() => {
    if (!path || hold.current) return;
    let cancelled = false;
    fileRequest(path)
      .then((r) => r.json())
      .then((d: { content?: string; original?: string; image?: boolean; binary?: boolean; error?: string }) => {
        if (cancelled) return;
        const next: FileData = { path, content: d.content ?? '', original: d.original ?? '', image: d.image, binary: d.binary, error: d.error };
        setFile((prev) => (prev && prev.path === path && prev.content === next.content && prev.original === next.original && prev.image === next.image && prev.binary === next.binary && prev.error === next.error ? prev : next));
      })
      .catch(() => {
        if (!cancelled) setFile({ path, content: '', original: '', error: 'The file could not be loaded' });
      });
    return () => {
      cancelled = true;
    };
  }, [path, bump, tick]);
  return [file?.path === path ? file : null, () => setTick((n) => n + 1)] as const;
}

class Guard extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? <div className="cd-empty">This file could not be shown</div> : this.props.children;
  }
}

function Breadcrumbs({ path }: { path: string }) {
  const parts = path.split('/');
  return (
    <div className="cd-crumbs" title={path}>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <Icon name="chevron-right" small />}
          <span className="cd-crumb">
            {i === parts.length - 1 && <FileIcon name={p} />}
            {p}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function Toggle({ on, icon, title, onClick }: { on?: boolean; icon: string; title: string; onClick: () => void }) {
  return (
    <button className={`cd-btn${on ? ' on' : ''}`} title={title} aria-pressed={on} onClick={onClick}>
      <Icon name={icon} small />
    </button>
  );
}

function FileMenu() {
  const slot = useSlot('page-file-action');
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  if (!slot) return null;
  return createPortal(
    <>
      <IconButton ref={more} icon="kebab-vertical" label="More" size="sm" small aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
      {menu && (
        <Menu trigger={more} onClose={() => setMenu(false)}>
          <MenuItem icon="close" onClick={() => { setMenu(false); setUi({ openFile: null }); }}>Close file</MenuItem>
        </Menu>
      )}
    </>,
    slot,
  );
}

export function CodePane() {
  const openFile = useStore((s) => s.ui.openFile);
  const openLine = useStore((s) => s.ui.openLine);
  const follow = useStore((s) => s.ui.follow);
  const openEdit = useStore((s) => s.ui.openEdit);
  const recent = useStore((s) => s.recentFiles);
  const chat = useStore((s) => s.session.id);
  const cwd = useStore((s) => s.session.cwd);
  const [mode, setMode] = useState<'diff' | 'file'>('diff');
  const [wrap, setWrap] = useState(false);
  const [preview, setPreview] = useState(true);
  const [changesOnly, setChangesOnly] = useState(true);
  const [edit, setEdit] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<'' | 'saving' | 'saved' | 'failed'>('');
  const viewRef = useRef<EditorView | null>(null);
  const [file, reload] = useFile(openFile, recent[0] === openFile ? recent : null, edit && dirty);

  useEffect(() => {
    setEdit(false);
    setDirty(false);
    setSaving('');
  }, [openFile]);

  useEffect(() => {
    if (!openEdit) return;
    setEdit(true);
    setPreview(false);
    setUi({ openEdit: false });
  }, [openEdit]);

  useEffect(() => {
    const files = getOpenedChat() === chat ? getOpened() : recent.slice(0, 5).reverse();
    setOpenedChat(chat);
    setOpened(openFile && !files.includes(openFile) ? [...files, openFile] : files);
  }, [openFile, chat]);

  if (!openFile) return null;

  const canDiff = Boolean(file?.original) && file?.original !== file?.content;
  const isDoc = /\.(md|markdown|mdx)$/i.test(openFile);
  const showDoc = preview && isDoc;
  const diff = canDiff && mode === 'diff' && !showDoc && !edit;
  const canEdit = Boolean(file) && !file?.error && !file?.image && !file?.binary && !showDoc;

  const saveText = async (text: string) => {
    if (!openFile) return;
    setSaving('saving');
    try {
      const r = await fileRequest(openFile, { method: 'PUT', body: text });
      if (!r.ok) throw new Error(await r.text());
      setDirty(false);
      setSaving('saved');
      reload();
      setTimeout(() => setSaving((s) => (s === 'saved' ? '' : s)), 1500);
    } catch {
      setSaving('failed');
    }
  };
  const saveNow = () => {
    const view = viewRef.current;
    if (view) void saveText(view.state.doc.toString());
  };

  const openInVsCode = () => {
    const view = viewRef.current;
    const line = view ? view.state.doc.lineAt(view.state.selection.main.head).number : 1;
    window.location.href = `vscode://file/${encodeURI(`${cwd}/${openFile}`)}:${line}`;
  };

  return (
    <div className="cd-pane">
      <FileMenu />
      <div className="cd-bar">
        <Breadcrumbs path={openFile} />
        <div className="cd-actions">
          {isDoc && <Toggle on={showDoc} icon="open-preview" title={showDoc ? 'Show the Markdown source' : 'Show the rendered document'} onClick={() => setPreview(!showDoc)} />}
          {canDiff && <Toggle on={diff} icon="diff" title="Show the change against the last commit" onClick={() => { setPreview(false); setMode(diff ? 'file' : 'diff'); }} />}
          {diff && <Toggle on={changesOnly} icon="fold" title="Changes only" onClick={() => setChangesOnly(!changesOnly)} />}
          {!showDoc && <Toggle on={wrap} icon="word-wrap" title="Word wrap" onClick={() => setWrap(!wrap)} />}
          {canEdit && <Toggle on={edit} icon="edit" title={edit ? 'Stop editing' : 'Edit this file'} onClick={() => { if (edit && dirty && !confirm('Drop the unsaved changes? This cannot be undone.')) return; setEdit(!edit); setDirty(false); setSaving(''); }} />}
          {edit && (dirty || saving) && <button className="cd-btn cd-save" title="Save (Cmd+S)" disabled={saving === 'saving' || !dirty} onClick={saveNow}>{saving === 'saving' ? 'Saving…' : saving === 'failed' ? 'Save failed' : saving === 'saved' ? 'Saved' : 'Save'}</button>}
          <Toggle on={follow} icon="eye" title="Follow the agent's edits" onClick={() => setUi({ follow: !follow })} />
          <Toggle icon="vscode" title="Open in VS Code" onClick={openInVsCode} />
        </div>
      </div>
      {file?.error && <div className="cd-empty">{file.error === 'path outside project' ? 'This file is outside the project folder' : file.error}</div>}
      {file?.image && <div className="cd-empty"><img src={api(`/api/image?path=${encodeURIComponent(file.path)}`)} alt={file.path} style={{ maxWidth: '100%', maxHeight: '100%' }} /></div>}
      {file?.binary && <div className="cd-empty">Binary file</div>}
      {file && !file.error && !file.image && !file.binary && (
        <Guard key={`${file.path}:${showDoc}`}>
          <Suspense fallback={null}>{showDoc ? <MarkdownDoc path={file.path} text={file.content} /> : <Editor file={file} diff={diff} wrap={wrap} changesOnly={changesOnly} line={openLine} viewRef={viewRef} edit={edit} onDirty={setDirty} onSave={(t) => void saveText(t)} />}</Suspense>
        </Guard>
      )}
    </div>
  );
}
