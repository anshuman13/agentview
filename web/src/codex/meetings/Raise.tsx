import { useEffect, useState } from 'react';
import { useAssistantData, useAssistantStore, useCodex } from '../data';
import { POINT, RAISED, endedPoints, firstName, pointMeeting } from '../data/points';
import type { AssistantStore } from '../data/store';
import type { ItemRow, Profile } from '../data/sync';
import { Icon } from '../../ui/Icon';
import { when } from '../time';
import { openMeeting, showSnack } from '../view';
import '../../styles/features/wiki.css';

export async function raise(store: AssistantStore, text: string, person: string, profile: Profile) {
  try {
    const row = await store.capture(text, 'note', profile);
    await store.update(row, { status: POINT, source: 'raise', people: person });
    showSnack(`Raise with ${firstName(person)} next time`, () => void store.update(row, { deleted: 1 }));
  } catch {
    showSnack('Not saved');
  }
}

// Marks open points raised once the meeting they wait for has ended.
export function useMarkRaised() {
  const store = useAssistantStore();
  const snap = useAssistantData();
  useEffect(() => {
    for (const r of endedPoints(snap.items, snap.meetings)) void store.update(r, { status: RAISED });
  }, [store, snap.items, snap.meetings]);
}

// A Raise button that opens a row of recent attendees to raise the text with.
export function RaiseWith({ text, profile, people, className = 'wk-act' }: { text: string; profile: Profile; people: string[]; className?: string }) {
  const store = useAssistantStore();
  const [open, setOpen] = useState(false);
  if (!people.length || !text.trim()) return null;
  if (!open) return <button className={className} title="Raise next time" onClick={() => setOpen(true)}><Icon name="comment" small /> Raise</button>;
  return (
    <span className="mt-raise">
      {people.map((p) => (
        <button key={p} className="btn sm" onClick={() => { setOpen(false); void raise(store, text.trim(), p, profile); }}>Raise with {firstName(p)}</button>
      ))}
      <button className="icon-btn" title="Close" aria-label="Close" onClick={() => setOpen(false)}><Icon name="close" small /></button>
    </span>
  );
}

export function AddPoint({ person, profile }: { person: string; profile: Profile }) {
  const store = useAssistantStore();
  const [text, setText] = useState('');
  const add = () => {
    const t = text.trim();
    if (!t) return;
    void raise(store, t, person, profile);
    setText('');
  };
  return (
    <form className="mt-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
      <Icon name="comment" small />
      <input value={text} placeholder={`Raise with ${firstName(person)}`} aria-label={`Raise with ${firstName(person)}`} onChange={(e) => setText(e.target.value)} />
    </form>
  );
}

export function PointList({ points, person = true, meeting = true }: { points: ItemRow[]; person?: boolean; meeting?: boolean }) {
  const store = useAssistantStore();
  const { meetings } = useCodex();
  const tick = (r: ItemRow) => {
    void store.update(r, { status: RAISED });
    showSnack('Raised', () => void store.update(r, { status: POINT }));
  };
  return (
    <ul className="wk-claims">
      {points.map((r) => {
        const m = meeting ? pointMeeting(r, meetings) : undefined;
        return (
          <li key={r.profile + r.id} className="wk-claim">
            <span className="wk-claim-text">{person && <b>{firstName(r.people ?? '')}: </b>}{r.title}</span>
            <span className="wk-claim-foot">
              {m && <button className="mt-person" onClick={() => openMeeting(m)}>{m.title} · {when(m.starts_at!, Date.now(), true)}</button>}
              <button className="wk-act" aria-label={`Raised ${r.title}`} onClick={(e) => { e.stopPropagation(); tick(r); }}><Icon name="check" small /> Raised</button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
