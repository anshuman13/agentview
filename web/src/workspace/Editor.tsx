import { useEffect, useRef, type MouseEvent, type MutableRefObject, type PointerEvent } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { unifiedMergeView } from '@codemirror/merge';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { showChat } from '../ui/util';
import { touch } from '../app/touch';
import { isDark, useThemeName } from '../app/theme';

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

export type FileData = { path: string; content: string; original: string; error?: string };

type EditorProps = { file: FileData; diff: boolean; wrap: boolean; changesOnly: boolean; line?: number | null; viewRef: MutableRefObject<EditorView | null> };

const PRESS_MS = 500;

// Puts the line into the composer as `path:line`: code, so a reply can point at it.
function quoteLine(path: string, line: number, text: string) {
  showChat();
  window.dispatchEvent(new CustomEvent('agentview:insert', { detail: { text: `\`${path}:${line}\`: ${text.trim()}` } }));
  window.dispatchEvent(new CustomEvent('agentview:focus'));
}

export function Editor({ file, diff, wrap, changesOnly, line, viewRef }: EditorProps) {
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

