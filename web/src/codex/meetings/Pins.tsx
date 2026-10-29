import { useEffect, useRef, useState } from 'react';
import { useAssistantStore } from '../data';
import type { ItemRow } from '../data/sync';
import type { Meeting } from '../data/wiki';
import { Icon } from '../../ui/Icon';
import { showSnack } from '../view';

type Sel = { text: string; x: number; y: number };

// A non-empty selection inside the element; selectionchange covers mouse, keyboard and touch handles.
function useSelectionIn(el: React.RefObject<HTMLElement | null>) {
  const [sel, setSel] = useState<Sel | null>(null);
  useEffect(() => {
    const read = () => {
      const s = window.getSelection();
      const text = s?.toString().trim();
      if (!s || s.rangeCount === 0 || !text || !el.current?.contains(s.anchorNode) || !el.current.contains(s.focusNode)) return setSel(null);
      const r = s.getRangeAt(0).getBoundingClientRect();
      setSel({ text, x: r.left + r.width / 2, y: r.bottom });
    };
    document.addEventListener('selectionchange', read);
    return () => document.removeEventListener('selectionchange', read);
  }, [el]);
  return [sel, () => { window.getSelection()?.removeAllRanges(); setSel(null); }] as const;
}

export function PinnableSummary({ m }: { m: Meeting }) {
  const store = useAssistantStore();
  const ref = useRef<HTMLParagraphElement>(null);
  const [sel, clear] = useSelectionIn(ref);
  const pin = async () => {
    if (!sel) return;
    const text = sel.text;
    clear();
    try {
      const row = await store.capture(text, 'note', m.profile, null, { id: m.id, title: m.title });
      await store.update(row, { title: text.slice(0, 120), text });
      showSnack('Pinned');
    } catch {
      showSnack('Not pinned');
    }
  };
  return (
    <>
      <p ref={ref} className="mt-summary">{m.summary}</p>
      {sel && (
        <button className="btn sm primary mt-pin-btn" style={{ left: Math.min(Math.max(sel.x, 40), window.innerWidth - 40), top: sel.y + 8 }}
          onMouseDown={(e) => e.preventDefault()} onClick={() => void pin()}><Icon name="pin" small /> Pin</button>
      )}
    </>
  );
}

export function PinList({ pins, onOpen }: { pins: ItemRow[]; onOpen?: (r: ItemRow) => void }) {
  const store = useAssistantStore();
  const unpin = (r: ItemRow) => {
    void store.update(r, { deleted: 1 });
    showSnack('Unpinned', () => void store.update(r, { deleted: 0 }));
  };
  return (
    <ul className="wk-claims mt-pins">
      {pins.map((r) => (
        <li key={r.profile + r.id} className="wk-claim">
          <span className="wk-claim-text">{r.text || r.title}</span>
          <span className="wk-claim-foot">
            {onOpen && <button className="mt-person" onClick={() => onOpen(r)}>{r.people}</button>}
            <button className="wk-act" title="Remove this pin" onClick={() => unpin(r)}><Icon name="close" small /> Unpin</button>
          </span>
        </li>
      ))}
    </ul>
  );
}
