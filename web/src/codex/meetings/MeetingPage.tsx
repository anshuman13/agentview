import { useEffect, useMemo, useRef, useState } from 'react';
import { useAssistantStore, useAssistantData, useCodex } from '../data';
import { ask, meetingAskText } from '../data/ask/ask';
import { followUpText, hasContent, toMarkdown } from '../data/meetings/meetingMarkdown';
import { parseWhen, stripWhen } from '../data/tasks/engine';
import { rowKey, type ItemRow } from '../data/sync';
import { linksOf, listOf, othersOf, type Meeting } from '../data/wiki/wiki';
import { linkDomain } from '../data/ask/links';
import { Row } from '../../ui/Row';
import { actionCount, actionsOf, displayName, isSolo, meetingState, peopleOf, pinsOf, seriesMeetings, seriesOf, seriesTitleOf } from '../data/meetings/meetings';
import { clock, when } from '../tasks/time';
import { useMinute } from '../tasks/split';
import { Button, Chip, IconButton } from '../../ui/Button';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { Section } from '../../ui/Section';
import { Icon } from '../../ui/Icon';
import { safeHref } from '../../ui/util';
import { Voice, useDictation } from '../../chat/composer/Voice';
import { clearNotesFocus, copyText, notesFocusFor, openSeries, setView, showSnack, useEscapeBack } from '../view';
import { AskBar } from '../wiki/Wiki';
import { Fold } from '../Fold';
import { ActionRow, confirmAll } from './ActionRow';
import { PinList, PinnableSummary } from './Pins';
import { Prep } from './Prep';
import { RaiseWith } from './Raise';
import { recentPeople } from '../data/meetings/points';
import { MeetingNotes } from './MeetingNotes';
import { Series } from './Series';
import { talkTime } from '../data/meetings/talkTime';
import { RoomMic, SummaryFormat, TalkTime, Transcript, TranscriptButton, readable, useRead, useTranscript } from './Transcript';

const ORDER: Record<string, number> = { open: 0, done: 1 };

function AddAction({ m }: { m: Meeting }) {
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
function StateLine({ m, now }: { m: Meeting; now: number }) {
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

function Notes({ m, editing, setEditing }: { m: Meeting; editing: boolean; setEditing: (on: boolean) => void }) {
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

export function MeetingPage({ m }: { m: Meeting }) {
  const store = useAssistantStore();
  const snap = useAssistantData();
  const { meetings } = useCodex();
  const prior = useMemo(() => seriesOf(meetings, m), [meetings, m]);
  const all = actionsOf(snap.items, m);
  const by = (st: string) => all.filter((r) => r.status === st);
  const mine = all.filter((r) => r.status === 'open' || r.status === 'done').sort((a, b) => (ORDER[a.status ?? ''] ?? 2) - (ORDER[b.status ?? ''] ?? 2) || a.updated_at - b.updated_at);
  const review = by('suggested');
  const pins = pinsOf(all, [m]);
  const count = actionCount(snap.items, m);
  const others = othersOf(m);
  const decisions = listOf(m.decisions);
  const links = linksOf(m);
  const people = peopleOf(m);
  const raiseTo = recentPeople(meetings, m.profile, m);
  const now = useMinute();
  const state = meetingState(m, now);
  const transcript = useTranscript(m, state === 'done');
  const talkers = useMemo(() => (transcript?.text ? talkTime(transcript.text).length : 0), [transcript?.text]);
  const family = useMemo(() => seriesMeetings(meetings, m.profile, seriesTitleOf(m), now), [meetings, m, now]);
  const back = () => setView({ open: null });
  useEscapeBack(back);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(() => notesFocusFor(rowKey(m)));
  const [moreOpen, setMoreOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const notesBox = useRef<HTMLElement>(null);
  const { busy: reading, read } = useRead(m);
  const link = m.calendar_url ? safeHref(m.calendar_url) : '';
  const copyable = hasContent(m, all);
  const canRead = state === 'done' && readable(m);
  const canMenu = !!link || copyable || canRead || !!m.notes;
  const takeNotes = () => {
    setEditing(true);
    notesBox.current?.scrollIntoView({ block: 'center' });
    notesBox.current?.querySelector('textarea')?.focus();
  };
  const deleteNotes = () => {
    const previous = m.notes;
    void store.editRow('meetings', m, { notes: '' });
    setEditing(false);
    showSnack('Notes deleted', () => void store.editRow('meetings', m, { notes: previous }));
  };
  const time = m.starts_at ? `${new Date(m.starts_at).toLocaleDateString([], { weekday: 'short' })} ${clock(m.starts_at)}${m.ends_at ? `-${clock(m.ends_at)}` : ''}` : '';
  const meta = [time, m.room, people.length ? (people.length === 1 ? '1 person' : `${people.length} people`) : '', m.recorded_ms ? `Recorded ${Math.round(m.recorded_ms / 60000)} min` : ''].filter(Boolean).join(' · ');
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <button className="icon-btn" title="Back to meetings" aria-label="Back" onClick={back}><Icon name="arrow-left" /></button>
        <nav className="wk-crumbs"><button onClick={back}>Meetings</button></nav>
      </header>
      <div className="wk-scroll">
        <article className="mt-page">
          <Section label={m.title || 'Untitled'} action={(
            <>
              {state === 'live' && link
                ? <a className="btn btn-filled btn-sm" href={link} target="_blank" rel="noreferrer"><Icon name="device-camera-video" small />Join</a>
                : <Button variant="filled" size="sm" icon="edit" onClick={takeNotes}>Notes</Button>}
              {canMenu && <span className="mt-more"><IconButton ref={more} icon="kebab-vertical" label="More" size="sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
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
              </span>}
            </>
          )} />
          {meta && <p className="mt-meta">{meta}</p>}
          {state !== 'done' && <StateLine m={m} now={now} />}
          {m.room && m.room_me == null && <RoomMic m={m} />}

          {links.length > 0 && (
            <section className="mt-sec">
              <h2>Links<span className="mt-of">{links.length}</span></h2>
              <div className="ui-group">{links.map((l) => <Row key={l.url} href={l.url} title={l.title} meta={linkDomain(l.url)} trailing={<Icon name="link-external" small />} />)}</div>
            </section>
          )}

          <section className="mt-sec">
            <h2>My actions{count.total > 0 && <span className="mt-of">{count.done} of {count.total} done</span>}</h2>
            {mine.length > 0 && <div className="mt-tasks">{mine.map((r) => <ActionRow key={r.profile + r.id} row={r} meeting={m} />)}</div>}
            {!mine.length && !review.length && (
              <p className="mt-pending">{state === 'missing' ? 'No transcript. Add actions under More.' : state === 'done' ? 'Nothing for you in the transcript.' : 'Your actions from the transcript land here and in Today.'}</p>
            )}
          </section>

          {review.length > 0 && (
            <section className="mt-sec">
              <h2>To review<span className="mt-of">{review.length}</span>{review.length > 1 && <button className="btn sm mt-sync" onClick={() => confirmAll(store, review)}><Icon name="check-all" small /> Confirm all</button>}</h2>
              <div className="mt-tasks">{review.map((r) => <ActionRow key={r.profile + r.id} row={r} meeting={m} />)}</div>
            </section>
          )}

          <section className="mt-sec">
            <h2><Icon name="sparkle" small /> Summary{m.summary && <SummaryFormat m={m} series={prior} />}</h2>
            {m.summary ? <PinnableSummary m={m} /> : <p className="mt-pending">{state === 'missing' ? 'No summary without a transcript.' : 'Written from the transcript after the meeting.'}</p>}
            {m.summary && pins.length > 0 && <PinList pins={pins} />}
          </section>

          {!m.summary && pins.length > 0 && (
            <section className="mt-sec">
              <h2>Pinned<span className="mt-of">{pins.length}</span></h2>
              <PinList pins={pins} />
            </section>
          )}

          {decisions.length > 0 && (
            <section className="mt-sec">
              <h2>Decisions</h2>
              <ul className="mt-decisions">{decisions.map((d, i) => <li key={i}>{d}<RaiseWith text={d} profile={m.profile} people={raiseTo} /></li>)}</ul>
            </section>
          )}

          {(state === 'upcoming' || state === 'live') && !isSolo(m) && <Prep m={m} section />}

          <section className="mt-sec" ref={notesBox}>
            <h2>My notes</h2>
            <Notes m={m} editing={editing} setEditing={setEditing} />
          </section>

          <Section label="More" open={moreOpen} onToggle={() => setMoreOpen(!moreOpen)} />
          {moreOpen && (
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
          )}
        </article>
      </div>
    </div>
  );
}
