import { useRef, useState } from 'react';
import type { AssistantStore, Patch } from '../data/store';
import type { ItemRow } from '../data/sync';
import { useOnUnmount } from '../../ui/util';

export type Saved = { title: string; text: string };

// What the title and notes fields would save now: a trimmed title only when it has one, notes as null when empty.
export function pendingPatch(title: string, text: string, saved: Saved): Patch {
  const patch: Patch = {};
  if (title.trim() && title.trim() !== saved.title) patch.title = title.trim();
  if (text !== saved.text) patch.text = text.trim() ? text : null;
  return patch;
}

// The open task's title and notes: typed text saves on blur or close, a control's change (checklist tick, repeat rule,
// estimate) shows at once and saves right away. saving holds the last write, so a move can wait for it.
export function useTaskDraft(row: ItemRow, store: AssistantStore) {
  const [title, setTitle] = useState(row.title ?? '');
  const [text, setText] = useState(row.text ?? '');
  const saved = useRef<Saved>({ title: row.title ?? '', text: row.text ?? '' });
  const saving = useRef<Promise<void>>(Promise.resolve());
  const write = (patch: Patch) => { saving.current = store.update(row, patch); };
  const save = () => {
    const patch = pendingPatch(title, text, saved.current);
    if (!Object.keys(patch).length) return;
    saved.current = { title: patch.title ?? saved.current.title, text };
    write(patch);
  };
  useOnUnmount(save);
  const putTitle = (next: string) => {
    setTitle(next);
    if (next === saved.current.title) return;
    saved.current = { ...saved.current, title: next };
    write({ title: next });
  };
  const putText = (next: string) => {
    setText(next);
    if (next === saved.current.text) return;
    saved.current = { ...saved.current, text: next };
    write({ text: next.trim() ? next : null });
  };
  return { title, setTitle, text, setText, putTitle, putText, save, write, saving };
}
