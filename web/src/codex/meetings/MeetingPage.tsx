import { useMemo, useRef, useState } from 'react';
import { useAssistantStore, useAssistantData, useCodex } from '../data';
import { hasContent } from '../data/meetings/meetingMarkdown';
import { rowKey } from '../data/sync';
import { linksOf, listOf, othersOf, type Meeting } from '../data/wiki/wiki';
import { linkDomain } from '../data/ask/links';
import { Row } from '../../ui/Row';
import { actionCount, actionsOf, isEvent, isSolo, meetingState, peopleOf, pinsOf, seriesMeetings, seriesOf, seriesTitleOf } from '../data/meetings/meetings';
import { clock } from '../tasks/time';
import { useMinute } from '../tasks/split';
import { Button, IconButton } from '../../ui/Button';
import { Section, sectionCount } from '../../ui/Section';
import { Icon } from '../../ui/Icon';
import { safeHref } from '../../ui/util';
import { notesFocusFor, setView, showSnack, useEscapeBack } from '../view';
import { ActionRow, confirmAll } from './ActionRow';
import { PinList, PinnableSummary } from './Pins';
import { Prep } from './Prep';
import { AddAction, MeetingMenu, MeetingMore, Notes, StateLine } from './MeetingPageParts';
import { RaiseWith } from './Raise';
import { recentPeople } from '../data/meetings/points';
import { talkTime } from '../data/meetings/talkTime';
import { RoomMic, SummaryFormat, readable, useTranscript } from './Transcript';
import { UNTITLED } from '../../../../shared/util';

const ORDER: Record<string, number> = { open: 0, done: 1 };

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
  const event = isEvent(m);
  const transcript = useTranscript(m, state === 'done');
  const talkers = useMemo(() => (transcript?.text ? talkTime(transcript.text).length : 0), [transcript?.text]);
  const family = useMemo(() => seriesMeetings(meetings, m.profile, seriesTitleOf(m), now), [meetings, m, now]);
  const back = () => setView({ open: null });
  useEscapeBack(back);
  const [editing, setEditing] = useState(() => notesFocusFor(rowKey(m)));
  const [moreOpen, setMoreOpen] = useState(false);
  const notesBox = useRef<HTMLElement>(null);
  const link = m.calendar_url ? safeHref(m.calendar_url) : '';
  const canMenu = !!link || hasContent(m, all) || (state === 'done' && readable(m)) || !!m.notes;
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
  const meta = event ? time : [time, m.room, people.length ? (people.length === 1 ? '1 person' : `${people.length} people`) : '', m.recorded_ms ? `Recorded ${Math.round(m.recorded_ms / 60000)} min` : ''].filter(Boolean).join(' · ');
  const notes = (
    <section className="mt-sec" ref={notesBox}>
      <h2>My notes</h2>
      <Notes m={m} editing={editing} setEditing={setEditing} />
    </section>
  );
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <IconButton icon="arrow-left" label="Back" title={event ? 'Back' : 'Back to meetings'} onClick={back} />
        <nav className="wk-crumbs"><button onClick={back}>{event ? 'Event' : 'Meetings'}</button></nav>
      </header>
      <div className="wk-scroll">
        <article className="mt-page">
          <Section label={m.title || UNTITLED} action={(
            <>
              {state === 'live' && link && !event
                ? <a className="btn btn-filled btn-sm" href={link} target="_blank" rel="noreferrer"><Icon name="device-camera-video" small />Join</a>
                : <Button variant="filled" size="sm" icon="edit" onClick={takeNotes}>Notes</Button>}
              {canMenu && <MeetingMenu m={m} all={all} state={state} deleteNotes={deleteNotes} />}
            </>
          )} />
          {meta && <p className="mt-meta">{meta}</p>}
          {state !== 'done' && <StateLine m={m} now={now} />}
          {m.room && m.room_me == null && <RoomMic m={m} />}

          {links.length > 0 && (
            <section className="mt-sec">
              <Section label="Links" count={sectionCount(links.length)} />
              <div className="ui-group">{links.map((l) => <Row key={l.url} href={l.url} title={l.title} meta={linkDomain(l.url)} trailing={<Icon name="link-external" small />} />)}</div>
            </section>
          )}

          {event && notes}

          <section className="mt-sec">
            <h2>My actions{count.total > 0 && <span className="mt-of">{count.done} of {count.total} done</span>}</h2>
            {mine.length > 0 && <div className="mt-tasks">{mine.map((r) => <ActionRow key={r.profile + r.id} row={r} meeting={m} />)}</div>}
            {event && <AddAction m={m} />}
            {!event && !mine.length && !review.length && (
              <p className="mt-pending">{state === 'missing' ? 'No transcript. Add actions under More.' : state === 'done' ? 'Nothing for you in the transcript.' : 'Your actions from the transcript land here and in Today.'}</p>
            )}
          </section>

          {!event && (
            <>
              {review.length > 0 && (
                <section className="mt-sec">
                  <Section label="To review" count={sectionCount(review.length)} action={review.length > 1 && <Button size="sm" className="mt-sync" onClick={() => confirmAll(store, review)}><Icon name="check-all" small /> Confirm all</Button>} />
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
                  <Section label="Pinned" count={sectionCount(pins.length)} />
                  <PinList pins={pins} />
                </section>
              )}

              {decisions.length > 0 && (
                <section className="mt-sec">
                  <Section label="Decisions" count={sectionCount(decisions.length)} />
                  <ul className="mt-decisions">{decisions.map((d, i) => <li key={i}>{d}<RaiseWith text={d} profile={m.profile} people={raiseTo} /></li>)}</ul>
                </section>
              )}

              {(state === 'upcoming' || state === 'live') && !isSolo(m) && <Prep m={m} section />}

              {notes}
            </>
          )}

          {!event && <Section label="More" open={moreOpen} onToggle={() => setMoreOpen(!moreOpen)} />}
          {!event && moreOpen && <MeetingMore m={m} all={all} state={state} prior={prior} family={family} people={people} decisions={decisions} others={others} count={count} transcript={transcript} talkers={talkers} />}
        </article>
      </div>
    </div>
  );
}
