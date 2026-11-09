import { useEffect, useRef, useState, type MouseEvent, type MutableRefObject, type PointerEvent } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { unifiedMergeView } from '@codemirror/merge';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { showChat } from '../ui/util';
import { touch } from '../app/touch/touch';
import { isDark, useThemeName } from '../app/theme';
import { Confirm, type ConfirmRequest } from '../ui/Confirm';
import { Menu, MenuItem } from '../ui/Menu';
import { blockAt, revertBlock } from './revertBlock';

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

export type FileData = { path: string; content: string; original: string; image?: boolean; binary?: boolean; error?: string };

type EditorProps = { file: FileData; diff: boolean; wrap: boolean; changesOnly: boolean; line?: number | null; viewRef: MutableRefObject<EditorView | null>; edit?: boolean; onDirty?: (dirty: boolean) => void; onSave?: (text: string) => void };

const PRESS_MS = 500;

// Puts the line into the composer as `path:line`: code, so a reply can point at it.
function quoteLine(path: string, line: number, text: string) {
  showChat();
  window.dispatchEvent(new CustomEvent('agentview:insert', { detail: { text: `\`${path}:${line}\`: ${text.trim()}` } }));
  window.dispatchEvent(new CustomEvent('agentview:focus'));
}

export function Editor({ file, diff, wrap, changesOnly, line, viewRef, edit = false, onDirty, onSave }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const scroll = useRef<{ path: string; top: number; head: number } | null>(null);
  const save = useRef(onSave);
  save.current = onSave;
  const dirty = useRef(onDirty);
  dirty.current = onDirty;
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const dark = isDark(useThemeName());

  const [menu, setMenu] = useState<{ x: number; y: number; block: number; quote: () => void } | null>(null);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const menuBox = useRef<HTMLSpanElement>(null);

  const openLine = (x: number, y: number) => {
    const view = viewRef.current;
    const pos = view?.posAtCoords({ x, y });
    if (!view || pos == null) return;
    const l = view.state.doc.lineAt(pos);
    const removed = document.elementFromPoint(x, y)?.closest('.cm-deletedLine');
    const quote = () => quoteLine(file.path, l.number, removed?.textContent ?? l.text);
    const block = file.original && !file.binary ? blockAt(file.original, file.content, l.number, Boolean(removed)) : -1;
    if (block < 0) quote();
    else setMenu({ x, y, block, quote });
  };
  const askRevert = (block: number) => setAsk({
    title: `Revert this change in ${file.path.split('/').pop()}?`,
    detail: 'The block goes back to the last commit.',
    action: 'Revert',
    run: async () => save.current?.(revertBlock(file.original, file.content, block)),
  });
  const release = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!diff || e.button !== 0) return;
    release();
    const { clientX: x, clientY: y } = e;
    press.current = { x, y, timer: setTimeout(() => { press.current = null; openLine(x, y); }, PRESS_MS) };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 8) release();
  };
  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    if (!diff) return;
    e.preventDefault();
    release();
    if (!touch()) openLine(e.clientX, e.clientY);
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
        EditorView.editable.of(edit),
        EditorState.readOnly.of(!edit),
        edit ? [history(), keymap.of([{ key: 'Mod-s', run: (v) => { save.current?.(v.state.doc.toString()); return true; } }, indentWithTab, ...defaultKeymap, ...historyKeymap]), EditorView.updateListener.of((u) => { if (u.docChanged) dirty.current?.(u.state.doc.toString() !== file.content); })] : [],
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
      } else if (scroll.current?.path === file.path) {
        view.scrollDOM.scrollTop = scroll.current.top;
        const head = Math.min(scroll.current.head, view.state.doc.length);
        view.dispatch({ selection: { anchor: head } });
      }
      viewRef.current = view;
    });
    return () => {
      cancelled = true;
      if (!view) return;
      scroll.current = { path: file.path, top: view.scrollDOM.scrollTop, head: view.state.selection.main.head };
      viewRef.current = null;
      view.destroy();
    };
  }, [file, diff, wrap, changesOnly, dark, line, edit]);

  return (
    <>
      <div className="cd-editor" ref={host} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={release} onPointerCancel={release} onContextMenu={onContextMenu} />
      {menu && (
        <span className="cd-linemenu" ref={menuBox} style={{ left: menu.x, top: menu.y }}>
          <Menu trigger={menuBox} onClose={() => setMenu(null)}>
            <MenuItem icon="comment" onClick={() => { menu.quote(); setMenu(null); }}>Quote line</MenuItem>
            <MenuItem icon="discard" danger onClick={() => { askRevert(menu.block); setMenu(null); }}>Revert this change</MenuItem>
          </Menu>
        </span>
      )}
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </>
  );
}
