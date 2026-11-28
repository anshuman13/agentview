import { useEffect, useRef, useState, type MouseEvent, type MutableRefObject, type PointerEvent } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { showChat } from '../ui/util';
import { touch } from '../app/touch/touch';
import { isDark, useThemeName } from '../app/theme';
import { Confirm, type ConfirmRequest } from '../ui/Confirm';
import { Menu, MenuItem } from '../ui/Menu';
import { Button } from '../ui/Button';
import { linesQuote } from '../../../shared/linesQuote';
import { blockAt, blockAtOld, revertBlock } from './revertBlock';
import { lineComments } from './lineComment';

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

type EditorProps = { file: FileData; diff: boolean; split?: boolean; wrap: boolean; changesOnly: boolean; line?: number | null; viewRef: MutableRefObject<EditorView | null>; edit?: boolean; onDirty?: (dirty: boolean) => void; onSave?: (text: string) => void };

const PRESS_MS = 500;

function toComposer(text: string) {
  showChat();
  window.dispatchEvent(new CustomEvent('agentview:insert', { detail: { text } }));
  window.dispatchEvent(new CustomEvent('agentview:focus'));
}

// Puts the line into the composer as `path:line`: code, so a reply can point at it.
const quoteLine = (path: string, line: number, text: string) => toComposer(`\`${path}:${line}\`: ${text.trim()}`);

type Pick = { x: number; y: number; text: string };

// The whole lines a selection in the file covers, as the composer quote; null when nothing is selected.
function pickOf(view: EditorView, path: string): Pick | null {
  const { from, to, head } = view.state.selection.main;
  if (from === to) return null;
  const doc = view.state.doc;
  const first = doc.lineAt(from);
  let last = doc.lineAt(to);
  if (to === last.from && last.number > first.number) last = doc.line(last.number - 1);
  const at = view.coordsAtPos(head);
  if (!at) return null;
  return { x: at.left, y: at.bottom + 4, text: linesQuote(path, first.number, last.number, doc.sliceString(first.from, last.to)) };
}

export function Editor({ file, diff, split = false, wrap, changesOnly, line, viewRef, edit = false, onDirty, onSave }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const scroll = useRef<{ path: string; top: number; head: number } | null>(null);
  const save = useRef(onSave);
  save.current = onSave;
  const dirty = useRef(onDirty);
  dirty.current = onDirty;
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const merge = useRef<MergeView | null>(null);
  const dark = isDark(useThemeName());

  const [pick, setPick] = useState<Pick | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; block: number; quote: () => void } | null>(null);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const menuBox = useRef<HTMLSpanElement>(null);

  const openLine = (x: number, y: number) => {
    // In the split view the left side is the last commit: quote and revert by its line.
    const old = split ? document.elementFromPoint(x, y)?.closest('.cm-merge-a') : null;
    const view = old ? merge.current?.a : viewRef.current;
    const pos = view?.posAtCoords({ x, y });
    if (!view || pos == null) return;
    const l = view.state.doc.lineAt(pos);
    const removed = old ? null : document.elementFromPoint(x, y)?.closest('.cm-deletedLine');
    const quote = () => quoteLine(file.path, l.number, removed?.textContent ?? l.text);
    const block = !file.original || file.binary ? -1 : old ? blockAtOld(file.original, file.content, l.number) : blockAt(file.original, file.content, l.number, Boolean(removed));
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
  // Selected lines of the file (not the last commit's side of the split view) offer Add to chat.
  const readPick = (target: EventTarget) => {
    const view = viewRef.current;
    const old = (target as Element).closest?.('.cm-merge-a');
    // After CodeMirror's own mouseup has settled the selection.
    setTimeout(() => setPick(view && !edit && !old && view === viewRef.current ? pickOf(view, file.path) : null));
  };
  const addPick = () => {
    if (!pick) return;
    toComposer(pick.text);
    const view = viewRef.current;
    if (view) view.dispatch({ selection: { anchor: view.state.selection.main.head } });
    setPick(null);
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
    let scroller: HTMLElement | null = null;
    const drop = () => setPick(null);
    setPick(null);
    lang(file.path).then((language) => {
      if (cancelled) return;
      const collapse = changesOnly ? { margin: 3, minSize: 4 } : undefined;
      const extensions = [
        lineNumbers(),
        EditorView.editable.of(edit),
        EditorState.readOnly.of(!edit),
        edit ? [history(), keymap.of([{ key: 'Mod-s', run: (v) => { save.current?.(v.state.doc.toString()); return true; } }, indentWithTab, ...defaultKeymap, ...historyKeymap]), EditorView.updateListener.of((u) => { if (u.docChanged) dirty.current?.(u.state.doc.toString() !== file.content); })] : [],
        EditorView.theme({}, { dark }),
        syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle),
        language,
        wrap ? EditorView.lineWrapping : [],
        diff && !split ? [unifiedMergeView({ original: file.original, mergeControls: false, collapseUnchanged: collapse }), edit ? [] : lineComments(file.path)] : [],
        EditorState.phrases.of({ '$ unchanged lines': '⋯ $ unchanged lines' }),
      ];
      if (diff && split) {
        merge.current = new MergeView({ a: { doc: file.original, extensions }, b: { doc: file.content, extensions: [extensions, lineComments(file.path)] }, parent, collapseUnchanged: collapse });
        view = merge.current.b;
        scroller = merge.current.dom;
      } else {
        view = new EditorView({ state: EditorState.create({ doc: file.content, extensions }), parent });
        scroller = view.scrollDOM;
      }
      if (line && line <= view.state.doc.lines) {
        // A review finding opens the file on its line.
        const l = view.state.doc.line(line);
        view.dispatch({ selection: { anchor: l.from, head: l.to }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
      } else if (scroll.current?.path === file.path) {
        scroller.scrollTop = scroll.current.top;
        const head = Math.min(scroll.current.head, view.state.doc.length);
        view.dispatch({ selection: { anchor: head } });
      }
      viewRef.current = view;
      scroller.addEventListener('scroll', drop, { passive: true });
    });
    return () => {
      cancelled = true;
      if (!view) return;
      scroller?.removeEventListener('scroll', drop);
      scroll.current = { path: file.path, top: scroller?.scrollTop ?? 0, head: view.state.selection.main.head };
      viewRef.current = null;
      if (merge.current) merge.current.destroy();
      else view.destroy();
      merge.current = null;
    };
  }, [file, diff, split, wrap, changesOnly, dark, line, edit]);

  return (
    <>
      <div className="cd-editor" ref={host} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(e) => { release(); readPick(e.target); }} onPointerCancel={release} onKeyUp={(e) => readPick(e.target)} onContextMenu={onContextMenu} />
      {pick && !menu && (
        <span className="cd-addchat" style={{ left: pick.x, top: pick.y }} onMouseDown={(e) => e.preventDefault()}>
          <Button size="sm" variant="filled" icon="comment" onClick={addPick}>Add to chat</Button>
        </span>
      )}
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
