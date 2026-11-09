import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAssistantStore } from '../data';
import type { Meeting } from '../data/wiki/wiki';
import { fitHeight } from '../../ui/util';
import { Chip } from '../../ui/Button';
import { NOTES_TEMPLATES, notesTemplateCaret, notesTemplateChips, notesTemplateText, rememberNotesTemplate, type NotesTemplate } from '../data/meetings/notesTemplates';
import { caretLine, RelatedStrip } from '../Related';

const SAVE_AFTER = 800;

// Saves while you type, and before the page hides or the meeting closes; takes synced notes while the field is not focused.
export function MeetingNotes({ m, templates }: { m: Meeting; templates?: boolean }) {
  const store = useAssistantStore();
  const [text, setText] = useState(m.notes ?? '');
  const [line, setLine] = useState('');
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
  const caret = useRef<number | null>(null);
  useEffect(() => {
    fitHeight(area.current);
    if (caret.current !== null) area.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [text]);
  const change = (el: HTMLTextAreaElement) => {
    const value = el.value;
    setText(value);
    setLine(caretLine(el));
    pending.current = value;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_AFTER);
  };
  const chips = useMemo(() => notesTemplateChips(m), [m.profile, m.title, m.id]);
  const insert = (key: NotesTemplate) => {
    const el = area.current;
    if (!el) return;
    el.value = notesTemplateText(key);
    change(el);
    caret.current = notesTemplateCaret(key);
    el.focus();
    rememberNotesTemplate(m, key);
  };
  return (
    <>
      <textarea ref={area} className="mt-notes" value={text} rows={2} aria-label="Your notes" placeholder="Write your notes. They stay yours; the summary is written separately."
        onChange={(e) => change(e.target)} onBlur={() => { const typed = pending.current !== null; flush(); if (!typed) setText(row.current.notes ?? ''); }} />
      {templates && !text && (
        <div className="mt-templates">
          {chips.map((c) => <Chip key={c.key} on={c.selected} className="pill" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(c.key)}>{NOTES_TEMPLATES[c.key].label}</Chip>)}
        </div>
      )}
      <RelatedStrip text={line} profile={m.profile} skip={m.id} />
    </>
  );
}
