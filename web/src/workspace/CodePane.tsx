import { Component, Fragment, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import type { EditorView } from '@codemirror/view';
import { api, setUi, useStore } from '../app/store';
import { Icon } from '../ui/Icon';
import { FileIcon } from './FileIcon';
import { getOpened, getOpenedChat, setOpened, setOpenedChat } from './opened';
import type { FileData } from './Editor';
import '../styles/features/code.css';

const Editor = lazy(() => import('./Editor').then((m) => ({ default: m.Editor })));
const MarkdownDoc = lazy(() => import('./MarkdownDoc').then((m) => ({ default: m.MarkdownDoc })));

function useFile(path: string | null, bump: unknown) {
  const [file, setFile] = useState<FileData | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') setTick((n) => n + 1);
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    fetch(api(`/api/file?path=${encodeURIComponent(path)}`))
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
  return file?.path === path ? file : null;
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

export function CodePane() {
  const openFile = useStore((s) => s.ui.openFile);
  const openLine = useStore((s) => s.ui.openLine);
  const follow = useStore((s) => s.ui.follow);
  const recent = useStore((s) => s.recentFiles);
  const chat = useStore((s) => s.session.id);
  const cwd = useStore((s) => s.session.cwd);
  const [mode, setMode] = useState<'diff' | 'file'>('diff');
  const [wrap, setWrap] = useState(false);
  const [preview, setPreview] = useState(true);
  const [changesOnly, setChangesOnly] = useState(true);
  const viewRef = useRef<EditorView | null>(null);
  const file = useFile(openFile, recent[0] === openFile ? recent : null);

  useEffect(() => {
    const files = getOpenedChat() === chat ? getOpened() : recent.slice(0, 5).reverse();
    setOpenedChat(chat);
    setOpened(openFile && !files.includes(openFile) ? [...files, openFile] : files);
  }, [openFile, chat]);

  if (!openFile) return null;

  const canDiff = Boolean(file?.original) && file?.original !== file?.content;
  const isDoc = /\.(md|markdown|mdx)$/i.test(openFile);
  const showDoc = preview && isDoc;
  const diff = canDiff && mode === 'diff' && !showDoc;

  const openInVsCode = () => {
    const view = viewRef.current;
    const line = view ? view.state.doc.lineAt(view.state.selection.main.head).number : 1;
    window.location.href = `vscode://file/${encodeURI(`${cwd}/${openFile}`)}:${line}`;
  };

  return (
    <div className="cd-pane">
      <div className="cd-bar">
        <Breadcrumbs path={openFile} />
        <div className="cd-actions">
          {isDoc && <Toggle on={showDoc} icon="open-preview" title={showDoc ? 'Show the Markdown source' : 'Show the rendered document'} onClick={() => setPreview(!showDoc)} />}
          {canDiff && <Toggle on={diff} icon="diff" title="Show the change against the last commit" onClick={() => { setPreview(false); setMode(diff ? 'file' : 'diff'); }} />}
          {diff && <Toggle on={changesOnly} icon="fold" title="Changes only" onClick={() => setChangesOnly(!changesOnly)} />}
          {!showDoc && <Toggle on={wrap} icon="word-wrap" title="Word wrap" onClick={() => setWrap(!wrap)} />}
          <Toggle on={follow} icon="eye" title="Follow Claude's edits" onClick={() => setUi({ follow: !follow })} />
          <Toggle icon="vscode" title="Open in VS Code" onClick={openInVsCode} />
        </div>
      </div>
      {file?.error && <div className="cd-empty">{file.error === 'path outside project' ? 'This file is outside the project folder' : file.error}</div>}
      {file?.image && <div className="cd-empty"><img src={api(`/api/image?path=${encodeURIComponent(file.path)}`)} alt={file.path} style={{ maxWidth: '100%', maxHeight: '100%' }} /></div>}
      {file?.binary && <div className="cd-empty">Binary file</div>}
      {file && !file.error && !file.image && !file.binary && (
        <Guard key={`${file.path}:${showDoc}`}>
          <Suspense fallback={null}>{showDoc ? <MarkdownDoc path={file.path} text={file.content} /> : <Editor file={file} diff={diff} wrap={wrap} changesOnly={changesOnly} line={openLine} viewRef={viewRef} />}</Suspense>
        </Guard>
      )}
    </div>
  );
}
