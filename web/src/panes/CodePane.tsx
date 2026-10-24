import { Component, Fragment, useEffect, useRef, useState, type MouseEvent, type MutableRefObject, type PointerEvent, type ReactNode } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { unifiedMergeView } from '@codemirror/merge';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { api, setUi, useStore } from '../store';
import { Icon } from '../Icon';
import { FileIcon } from './Explorer';
import { MarkdownDoc } from './MarkdownDoc';
import { getOpened, getOpenedChat, setOpened, setOpenedChat } from './opened';
import { showChat } from './util';
import { touch } from '../touch';
import { isDark, useThemeName } from '../theme';
import '../styles/features/code.css';

async function lang(path: string): Promise<Extension> {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) return (await import('@codemirror/lang-javascript')).javascript({ typescript: ext.startsWith('ts'), jsx: ext.endsWith('x') });
  if (ext === 'py') return (await import('@codemirror/lang-python')).python();
  if (ext === 'json') return (await import('@codemirror/lang-json')).json();
  if (ext === 'md') return (await import('@codemirror/lang-markdown')).markdown();
  if (ext === 'html') return (await import('@codemirror/lang-html')).html();
  if (ext === 'css') return (await import('@codemirror/lang-css')).css();
  return [];
}

type FileData = { path: string; content: string; original: string; error?: string };

function useFile(path: string | null, bump: unknown) {
  const [file, setFile] = useState<FileData | null>(null);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    fetch(api(`/api/file?path=${encodeURIComponent(path)}`))
      .then((r) => r.json())
      .then((d: { content?: string; original?: string; error?: string }) => {
        if (!cancelled) setFile({ path, content: d.content ?? '', original: d.original ?? '', error: d.error });
      })
      .catch(() => {
        if (!cancelled) setFile({ path, content: '', original: '', error: 'The file could not be loaded' });
      });
    return () => {
      cancelled = true;
    };
  }, [path, bump]);
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

type EditorProps = { file: FileData; diff: boolean; wrap: boolean; changesOnly: boolean; line?: number | null; viewRef: MutableRefObject<EditorView | null> };

const PRESS_MS = 500;

// Puts the line into the composer as `path:line`: code, so a reply can point at it.
function quoteLine(path: string, line: number, text: string) {
  showChat();
  window.dispatchEvent(new CustomEvent('agentview:insert', { detail: { text: `\`${path}:${line}\`: ${text.trim()}` } }));
  window.dispatchEvent(new CustomEvent('agentview:focus'));
}

function Editor({ file, diff, wrap, changesOnly, line, viewRef }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const scroll = useRef<{ path: string; top: number } | null>(null);
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const dark = isDark(useThemeName());

  const quoteAt = (x: number, y: number) => {
    const view = viewRef.current;
    const pos = view?.posAtCoords({ x, y });
    if (!view || pos == null) return;
    const l = view.state.doc.lineAt(pos);
    const removed = document.elementFromPoint(x, y)?.closest('.cm-deletedLine');
    quoteLine(file.path, l.number, removed?.textContent ?? l.text);
  };
  const release = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!diff || e.button !== 0) return;
    release();
    const { clientX: x, clientY: y } = e;
    press.current = { x, y, timer: setTimeout(() => { press.current = null; quoteAt(x, y); }, PRESS_MS) };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 8) release();
  };
  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    if (!diff) return;
    e.preventDefault();
    release();
    if (!touch()) quoteAt(e.clientX, e.clientY);
  };

  useEffect(() => {
    if (!host.current) return;
    const parent = host.current;
    let cancelled = false;
    let view: EditorView | null = null;
    lang(file.path).then((language) => {
      if (cancelled) return;
      const extensions = [
        lineNumbers(),
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        EditorView.theme({}, { dark }),
        syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle),
        language,
        wrap ? EditorView.lineWrapping : [],
        diff ? unifiedMergeView({ original: file.original, mergeControls: false, collapseUnchanged: changesOnly ? { margin: 3, minSize: 4 } : undefined }) : [],
        EditorState.phrases.of({ '$ unchanged lines': '⋯ $ unchanged lines' }),
      ];
      view = new EditorView({ state: EditorState.create({ doc: file.content, extensions }), parent });
      if (line && line <= view.state.doc.lines) {
        // A review finding opens the file on its line.
        const l = view.state.doc.line(line);
        view.dispatch({ selection: { anchor: l.from, head: l.to }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
      } else if (scroll.current?.path === file.path) view.scrollDOM.scrollTop = scroll.current.top;
      viewRef.current = view;
    });
    return () => {
      cancelled = true;
      if (!view) return;
      scroll.current = { path: file.path, top: view.scrollDOM.scrollTop };
      viewRef.current = null;
      view.destroy();
    };
  }, [file, diff, wrap, changesOnly, dark, line]);

  return <div className="cd-editor" ref={host} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={release} onPointerCancel={release} onContextMenu={onContextMenu} />;
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
    const files = getOpenedChat() === chat ? getOpened() : [...recent].reverse();
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
      {file && !file.error && (
        <Guard key={`${file.path}:${showDoc}`}>
          {showDoc ? <MarkdownDoc path={file.path} text={file.content} /> : <Editor file={file} diff={diff} wrap={wrap} changesOnly={changesOnly} line={openLine} viewRef={viewRef} />}
        </Guard>
      )}
    </div>
  );
}
