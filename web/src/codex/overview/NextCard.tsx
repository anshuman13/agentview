import { useRef, useState } from 'react';
import { useAssistantStore } from '../data';
import type { Meeting } from '../data/wiki';
import { peopleOf, stampedNotes } from '../data/meetings';
import { Prep } from '../meetings/Prep';
import { Icon } from '../../ui/Icon';
import { Section } from '../../ui/Section';
import { setView, showSnack } from '../view';
import { clock } from '../time';

// The next meeting today: Prep asks Claude, Notes opens the meeting, and the mic toggle tells the transcript reader
// that the room microphone is me.
export function NextCard({ m, then, carried, onPrep }: { m: Meeting; then?: Meeting; carried: number; onPrep: () => void }) {
  const store = useAssistantStore();
  const now = Date.now();
  const mins = Math.round((m.starts_at! - now) / 60000);
  const open = () => setView({ list: 'meetings', open: `${m.profile}:${m.id}` });
  const people = peopleOf(m);
  const [jot, setJot] = useState('');
  const saved = useRef('');
  const addNote = () => {
    const text = jot.trim();
    if (!text || saved.current === jot) return;
    saved.current = jot;
    setJot('');
    const cur = store.snapshot().meetings.find((x) => x.profile === m.profile && x.id === m.id) ?? m;
    void store.editRow('meetings', cur, { notes: stampedNotes(cur.notes, text, Date.now()) }).then(() => showSnack('Added to the notes'));
  };
  return (
    <div className="as-next" onClick={open} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } }}>
      <Section label="Next" action={<><span>{clock(m.starts_at!)}</span><span>{mins <= 0 ? 'now' : mins < 60 ? `in ${mins} min` : `in ${Math.round(mins / 60)} h`}</span></>} />
      <div className="as-next-title">{m.title}</div>
      {(people.length > 0 || carried > 0) && (
        <div className="as-ctx">
          {people.length > 0 && <span>{people.slice(0, 3).join(', ')}{people.length > 3 ? ` +${people.length - 3}` : ''}</span>}
          {carried > 0 && <span className="as-due late">{carried} open from last time</span>}
        </div>
      )}
      <Prep m={m} />
      <input className="as-next-jot" value={jot} placeholder="Jot a note" enterKeyHint="done" aria-label={`Note for ${m.title}`}
        onClick={(e) => e.stopPropagation()} onChange={(e) => { saved.current = ''; setJot(e.target.value); }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') addNote(); }} onBlur={addNote} />
      <div className="as-next-actions">
        <button className="btn btn-sm btn-gray" onClick={(e) => { e.stopPropagation(); onPrep(); }}><Icon name="sparkle" small /> Prep</button>
        <button className="btn btn-sm btn-gray" onClick={(e) => { e.stopPropagation(); open(); }}><Icon name="edit" small /> Notes</button>
        {m.id.startsWith('cal:') && (
          <button className={`btn sm${m.room_me === 1 ? ' on' : ''}`} title="I am on the room microphone in this meeting" aria-pressed={m.room_me === 1}
            onClick={(e) => { e.stopPropagation(); void store.editRow('meetings', m, { room_me: m.room_me === 1 ? null : 1 }); }}>
            <Icon name="mic" small /> Room mic is me
          </button>
        )}
      </div>
      {then && <div className="as-next-then">then {clock(then.starts_at!)} {then.title}</div>}
    </div>
  );
}
