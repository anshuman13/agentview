import { useEffect, useRef, useState } from 'react';
import { useAssistantStore } from '../data';
import { followUpText, toMarkdown } from '../data/meetings/meetingMarkdown';
import { parseWhen, stripWhen } from '../data/tasks/engine';
import type { ItemRow } from '../data/sync';
import { displayName, meetingState } from '../data/meetings/meetings';
import { when } from '../tasks/time';
import { Chip, IconButton } from '../../ui/Button';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { Icon } from '../../ui/Icon';
import { safeHref } from '../../ui/util';
import { Voice, useDictation } from '../../chat/composer/Voice';
import { clearNotesFocus, copyText, openSeries, setView } from '../view';
import { Fold } from '../Fold';
import { ActionRow } from './ActionRow';
import { Series } from './Series';
import { MeetingNotes } from './MeetingNotes';
import { AskBar } from '../wiki/Wiki';
import { ask, meetingAskText } from '../data/ask/ask';
import { rowKey } from '../data/sync';
import { hasContent } from '../data/meetings/meetingMarkdown';
import { Transcript, TalkTime, TranscriptButton, readable, useRead, useTranscript } from './Transcript';
import type { Meeting } from '../data/wiki/wiki';

export function AddAction({ m }: { m: Meeting }) {
  const store = useAssistantStore();
  const [text, setText] = useState('');
  const dictate = useDictation(text, setText);
  const add = () => {
    const t = text.trim();
    if (!t) return;
    const w = parseWhen(t);
    void store.capture(stripWhen(t, w) || t, 'task', m.profile, w?.at ?? null, { id: m.id, title: m.title });
    setText('');
  };
  return (
    <form className="mt-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
      <Icon name="add" small />
      <input value={text} placeholder="Add an action, like “send the slides friday”" aria-label="Add an action" onChange={(e) => setText(e.target.value)} />
      <Voice onText={dictate} />
    </form>
  );
}

// One line on where the meeting is, so an empty action list always has a reason.
export function StateLine({ m, now }: { m: Meeting; now: number }) {
  const store = useAssistantStore();
  const state = meetingState(m, now);
  const parts: string[] = [];
  if (state === 'upcoming') parts.push(`Starts ${when(m.starts_at!, now)}`);
  if (state === 'live') parts.push('In progress');
  if (state === 'waiting') parts.push('Waiting for the transcript');
  if (state === 'missing') parts.push('No transcript for this meeting');
  if (!parts.length) return null;
  return (
    <div className={`mt-state ${state}`}>
      <span>{parts.join(' · ')}</span>
      {(state === 'waiting' || state === 'missing') && <TranscriptButton m={m} label={state === 'missing' ? 'Retry' : 'Read now'} />}
      {state === 'missing' && <button className="btn sm" title="Nothing to add for this meeting" onClick={() => void store.editRow('meetings', m, { transcript: 'done' })}>Dismiss</button>}
    </div>
  );
}

export function Notes({ m, editing, setEditing }: { m: Meeting; editing: boolean; setEditing: (on: boolean) => void }) {
  const [fresh] = useState(!m.notes);
  const box = useRef<HTMLDivElement>(null);
  useEffect(clearNotesFocus, []);
  useEffect(() => { if (editing) box.current?.querySelector('textarea')?.focus(); }, [editing]);
  if (!m.notes && !editing) return <button className="mt-pending mt-add-notes" onClick={() => setEditing(true)}><Icon name="add" small /> Add notes</button>;
  return (
    <div ref={box} onBlur={(e) => { if (e.target instanceof HTMLTextAreaElement && !e.target.value) setEditing(false); }}>
      <MeetingNotes key={rowKey(m)} m={m} templates={fresh} />
    </div>
  );
}

type MenuProps = { m: Meeting; all: ItemRow[]; state: string; deleteNotes: () => void };

export function MeetingMenu({ m, all, state, deleteNotes }: MenuProps) {
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const { busy: reading, read } = useRead(m);
  const link = m.calendar_url ? safeHref(m.calendar_url) : '';
  const copyable = hasContent(m, all);
  const canRead = state === 'done' && readable(m);
  return (
    <span className="mt-more"><IconButton ref={more} icon="kebab-vertical" label="More" size="sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
      {menu && (
        <Menu trigger={more} onClose={() => setMenu(false)}>
          {link && <MenuItem icon="calendar" href={link} onClick={() => setMenu(false)}>Open calendar</MenuItem>}
          {copyable && <MenuItem icon="mail" onClick={() => { setMenu(false); copyText(followUpText(m, all), 'Follow-up copied'); }}>Copy follow-up</MenuItem>}
          {copyable && <MenuItem icon="copy" onClick={() => { setMenu(false); copyText(toMarkdown(m, all)); }}>Copy as Markdown</MenuItem>}
          {canRead && <MenuItem icon={reading ? 'loading' : 'sync'} spin={reading} disabled={reading} onClick={() => { setMenu(false); void read(); }}>{reading ? 'Reading' : 'Read again'}</MenuItem>}
          {m.notes && <MenuSeparator />}
          {m.notes && <MenuItem icon="trash" danger onClick={() => { setMenu(false); deleteNotes(); }}>Delete notes</MenuItem>}
        </Menu>
      )}
    </span>
  );
}

type MoreProps = {
  m: Meeting;
  all: ItemRow[];
  state: ReturnType<typeof meetingState>;
  prior: Meeting[];
  family: Meeting[];
  people: string[];
  decisions: string[];
  others: { who: string; what: string }[];
  count: { unassigned: number; dismissed: number };
  transcript: ReturnType<typeof useTranscript>;
  talkers: number;
};

export function MeetingMore({ m, all, state, prior, family, people, decisions, others, count, transcript, talkers }: MoreProps) {
  const by = (st: string) => all.filter((r) => r.status === st);
  return (
    <>
      <AddAction m={m} />
      <Fold id="meeting-context" title="Context" count={(talkers ? 1 : 0) + (prior.length ? 1 : 0) + (family.length >= 2 ? 1 : 0) + (people.length ? 1 : 0)}>
        {transcript?.text && <TalkTime text={transcript.text} actions={all.filter((r) => r.status !== 'dismissed').length} decisions={decisions.length} />}
        <Series m={m} prior={prior} />
        {family.length >= 2 && <div className="mt-chips"><Chip title="Open the whole series" onClick={() => openSeries(m)}>{family[0].title} · {family.length}</Chip></div>}
        {people.length > 0 && <div className="mt-people"><span>{people.slice(0, 3).map((p, i) => <span key={p}>{i > 0 && ', '}<button className="mt-person" onClick={() => setView({ person: p })}>{displayName(p)}</button></span>)}{people.length > 3 ? ` and ${people.length - 3} more` : ''}</span></div>}
      </Fold>

      <Fold id="meeting-unassigned" remember={false} title="Unassigned" count={count.unassigned}>
        <div className="mt-tasks">{by('unassigned').map((r) => <ActionRow key={r.profile + r.id} row={r} meeting={m} />)}</div>
      </Fold>
      <Fold id="meeting-others" remember={false} title="Others took" count={others.length}>
        <ul className="mt-others">{others.map((o, i) => <li key={i}><b>{o.who}</b> {o.what}</li>)}</ul>
      </Fold>
      <Fold id="meeting-not-mine" remember={false} title="Not mine" count={count.dismissed}>
        <div className="mt-tasks">{by('dismissed').map((r) => <ActionRow key={r.profile + r.id} row={r} meeting={m} />)}</div>
      </Fold>
      {state === 'done' && <Transcript key={rowKey(m)} got={transcript} />}
      <AskBar placeholder="Ask about this meeting" onAsk={(q) => ask(meetingAskText(q, m, all), m.profile)} />
    </>
  );
}
