import { useCallback, useEffect, useRef, useState } from 'react';
import { useAssistantStore } from '../data';
import type { Meeting } from '../data/wiki';
import { fitHeight } from '../../ui/util';

const SAVE_AFTER = 800;

// Saves while you type, and before the page hides or the meeting closes; takes synced notes while the field is not focused.
export function MeetingNotes({ m }: { m: Meeting }) {
  const store = useAssistantStore();
  const [text, setText] = useState(m.notes ?? '');
  const area = useRef<HTMLTextAreaElement>(null);
  const row = useRef(m);
  row.current = m;
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const t = pending.current;
    pending.current = null;
    if (t !== null && t !== (row.current.notes ?? '')) void store.editRow('meetings', row.current, { notes: t });
  }, [store]);
  useEffect(() => {
    const hidden = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);
  useEffect(() => {
    if (pending.current === null && document.activeElement !== area.current) setText(m.notes ?? '');
  }, [m.notes]);
  useEffect(() => fitHeight(area.current), [text]);
  const change = (value: string) => {
    setText(value);
    pending.current = value;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_AFTER);
  };
  return (
    <textarea ref={area} className="mt-notes" value={text} rows={2} aria-label="Your notes" placeholder="Write your notes. They stay yours; the summary is written separately."
      onChange={(e) => change(e.target.value)} onBlur={() => { const typed = pending.current !== null; flush(); if (!typed) setText(row.current.notes ?? ''); }} />
  );
}
