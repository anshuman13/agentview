import { useEffect, useRef, useState, type RefObject } from 'react';
import { sendToChat } from '../app/store';
import { showSnack } from '../codex/view';
import { Button } from '../ui/Button';
import { docAskPrompt } from '../../../shared/docEdit';

type At = { quote: string; x: number; y: number };

// Text selected in the rendered doc, placed under the selection in the scroller's coordinates.
export function useSelectionAsk(body: RefObject<HTMLElement | null>, scroller: RefObject<HTMLDivElement | null>) {
  const [at, setAt] = useState<At | null>(null);
  const open = useRef(false);
  useEffect(() => {
    const read = () => {
      if (open.current) return;
      const sel = document.getSelection();
      const el = body.current;
      const box = scroller.current;
      const quote = sel?.toString().trim() ?? '';
      if (!sel || !el || !box || !quote || sel.rangeCount === 0 || !el.contains(sel.anchorNode) || el.querySelector('.doc-b-edit')?.contains(sel.anchorNode)) return setAt(null);
      const r = sel.getRangeAt(0).getBoundingClientRect();
      const b = box.getBoundingClientRect();
      setAt({ quote, x: Math.max(8, Math.min(r.left - b.left, b.width - 320)), y: r.bottom - b.top + box.scrollTop + 6 });
    };
    let t: ReturnType<typeof setTimeout>;
    const later = () => {
      clearTimeout(t);
      t = setTimeout(read, 250);
    };
    document.addEventListener('selectionchange', later);
    return () => {
      clearTimeout(t);
      document.removeEventListener('selectionchange', later);
    };
  }, [body, scroller]);
  return { at, clear: () => setAt(null), open };
}

export function DocAsk({ path, at, onDone, open }: { path: string; at: At; onDone: () => void; open: { current: boolean } }) {
  const [typing, setTyping] = useState(false);
  const [ask, setAsk] = useState('');
  useEffect(() => {
    open.current = typing;
    return () => void (open.current = false);
  }, [typing, open]);
  const self = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => !self.current?.contains(e.target as Node) && typing && onDone();
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [typing, onDone]);
  const send = () => {
    if (!ask.trim()) return;
    sendToChat(docAskPrompt(path, at.quote, ask));
    showSnack('Sent to the chat');
    document.getSelection()?.removeAllRanges();
    onDone();
  };
  return (
    <div ref={self} className="doc-ask" style={{ left: at.x, top: at.y }} onMouseDown={(e) => !typing && e.preventDefault()}>
      {typing ? (
        <>
          <input autoFocus placeholder="What should change?" value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); if (e.key === 'Escape') onDone(); }} />
          <Button size="sm" variant="filled" disabled={!ask.trim()} onClick={send}>Send</Button>
        </>
      ) : (
        <Button size="sm" variant="filled" icon="sparkle" onClick={() => setTyping(true)}>Ask Claude</Button>
      )}
    </div>
  );
}

export function BlockEditor({ raw, onSave, onCancel }: { raw: string; onSave: (text: string) => Promise<void> | void; onCancel: () => void }) {
  const [value, setValue] = useState(raw.replace(/\s+$/, ''));
  const [saving, setSaving] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  const save = async () => {
    setSaving(true);
    try {
      await onSave(value);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="doc-editor">
      <textarea ref={area} autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save(); }} />
      <div className="doc-editor-bar">
        <Button size="sm" variant="plain" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="filled" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </div>
  );
}
