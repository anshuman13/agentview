import { useState } from 'react';
import { useAssistantStore, useAssistantData } from '../data';
import type { ItemRow } from '../data/sync';
import { queryWords, rowMatcher } from '../data/wiki';
import { Icon } from '../../ui/Icon';
import { ago } from '../../ui/util';
import { ShowMore, useWindow } from '../../ui/useWindow';
import { showSnack, useFocusBack, useView } from '../view';

// A loose note: a capture that is not a task. Tap to edit; the first line is its title.
function NoteCard({ row }: { row: ItemRow }) {
  const store = useAssistantStore();
  const full = [row.title ?? '', row.text ?? ''].filter(Boolean).join('\n');
  const [text, setText] = useState<string | null>(null);
  const card = useFocusBack<HTMLButtonElement>(text !== null);
  const save = () => {
    const t = text?.trim();
    setText(null);
    if (t == null || t === full) return;
    if (!t) return void store.update(row, { deleted: 1 });
    const [first, ...rest] = t.split('\n');
    void store.update(row, { title: first.slice(0, 120), text: rest.join('\n').trim() || null });
  };
  const remove = () => {
    void store.update(row, { deleted: 1 });
    showSnack('Note deleted', () => void store.update(row, { deleted: 0 }));
  };
  const toTask = () => {
    void store.update(row, { status: 'open' });
    showSnack('Moved to Today', () => void store.update(row, { status: 'note' }));
  };
  if (text !== null) {
    return (
      <div className="wk-card wk-note editing">
        <textarea autoFocus value={text} aria-label="Note" onChange={(e) => setText(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Escape' && setText(null)} />
        <span className="wk-card-foot">
          <button className="btn sm" onMouseDown={(e) => e.preventDefault()} onClick={toTask}>Make task</button>
          <span className="spacer" />
          <button className="icon-btn" title="Delete" aria-label="Delete" onMouseDown={(e) => e.preventDefault()} onClick={remove}><Icon name="trash" small /></button>
        </span>
      </div>
    );
  }
  return (
    <button ref={card} className="wk-card wk-note" onClick={() => setText(full)}>
      <span className="wk-card-title">{row.title || '(Untitled)'}</span>
      {row.text && <span className="wk-card-summary">{row.text}</span>}
      <span className="wk-card-foot"><span>{ago(row.updated_at, ' ago')}</span><span className="spacer" /><span>{row.profile === 'personal' ? 'Personal' : 'Work'}</span></span>
    </button>
  );
}

function NewNoteCard() {
  const store = useAssistantStore();
  const { filter } = useView();
  const [text, setText] = useState<string | null>(null);
  const card = useFocusBack<HTMLButtonElement>(text !== null);
  const create = () => {
    const t = text?.trim();
    setText(null);
    if (t) void store.capture(t, 'note', filter === 'personal' ? 'personal' : 'work');
  };
  if (text === null) return <button ref={card} className="wk-card wk-new" onClick={() => setText('')}><Icon name="add" /> New note</button>;
  return (
    <div className="wk-card wk-new wk-note editing">
      <textarea autoFocus value={text} placeholder="First line is the title" aria-label="New note" onChange={(e) => setText(e.target.value)} onBlur={create} onKeyDown={(e) => e.key === 'Escape' && setText(null)} />
    </div>
  );
}

export function Notes({ query }: { query: string }) {
  const snap = useAssistantData();
  const { filter } = useView();
  const words = queryWords(query);
  const hit = rowMatcher<ItemRow>(words, 'note', (r) => [r.title, r.text]);
  const notes = snap.items
    .filter((r) => !r.deleted && r.status === 'note' && (filter === 'all' || r.profile === filter))
    .filter((r) => !words.length || hit(r))
    .sort((a, b) => b.updated_at - a.updated_at);
  const [shown, more] = useWindow(`${filter}|${query}`);
  if (words.length && !notes.length) return null;
  return (
    <section>
      <div className="wk-label">Notes</div>
      <div className="wk-cards">
        {notes.slice(0, shown).map((r) => <NoteCard key={r.profile + r.id} row={r} />)}
        {!words.length && <NewNoteCard />}
      </div>
      <ShowMore shown={shown} total={notes.length} onMore={more} />
    </section>
  );
}
