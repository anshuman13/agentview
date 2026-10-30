import { memo, useEffect, useMemo, useState } from 'react';
import { useAssistantData, useCodex } from '../data';
import { newId } from '../data/sync';
import { actionCount, actionCounts, groupMeetings, live, meetingState, openQuestions, peopleOf, searchMeetings, queryWords, rowMatcher, topicTimeline, trackedTopics, type Fact, type Meeting, type Question } from '../data/wiki';
import { clock, when } from '../time';
import { dayEnd, dayLabel, dayStart } from '../data/dates';
import { Icon } from '../../ui/Icon';
import { save, stored } from '../../ui/util';
import { ShowMore, capGroups, useWindow } from '../../ui/useWindow';
import { meetingKey, openMeeting, setView, showSnack, useView } from '../view';
import { ProfileDot } from '../ProfileDot';
import { Decisions } from './Decisions';
import { Load } from './Load';
import { OpenQuestions } from './OpenQuestions';
import { Week } from './Week';
import { useSnackTask } from './useSnackTask';
import { usePullSync } from '../pullSync';
import { useMinute } from '../split';
import '../../styles/features/wiki.css';

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const TOPICS_KEY = 'agentview.meetingTopics';
const SEEN_KEY = 'agentview.meetingTopicsSeen';

export function Avatars({ people, max = 3 }: { people: string[]; max?: number }) {
  if (!people.length) return null;
  const more = people.length - max;
  return (
    <span className="mt-avatars" title={people.join(', ')}>
      {people.slice(0, more > 0 ? max : people.length).map((p) => <span key={p}>{initials(p)}</span>)}
      {more > 0 && <span className="more">+{more}</span>}
    </span>
  );
}

// The badge says where the meeting is: coming up, waiting for its transcript, or what it left for me.
const Badge = memo(function Badge({ m, now, review, total, done }: { m: Meeting; now: number; review: number; total: number; done: number }) {
  const state = meetingState(m, now);
  if (state === 'missing') return <span className="mt-count st-warn" title="No Gemini notes were found for this meeting">No transcript</span>;
  if (review > 0) return <span className="mt-count st-warn" title="Suggested actions to keep or dismiss">{review} to review</span>;
  if (total > 0) {
    return (
      <span className={`mt-count${done === total ? ' st-ok' : ''}`} title="My actions done">
        <Icon name={done === total ? 'pass' : 'circle-large-outline'} small /> {done} of {total}
      </span>
    );
  }
  if (state === 'waiting') return <span className="mt-count muted" title="The transcript is read a few minutes after the meeting">Waiting</span>;
  if (state === 'done') return <span className="mt-count muted">Nothing for you</span>;
  return null;
});

const NO_TOPICS: string[] = [];
const NO_HITS = new Map<string, string>();

// What the hub finds in the transcripts for the query, by profile:id with a snippet; empty until it answers.
export function useTranscriptHits(query: string) {
  const { store } = useCodex();
  const [found, setFound] = useState({ q: '', hits: NO_HITS });
  const q = query.trim();
  useEffect(() => {
    if (!q) return;
    let live = true;
    const t = setTimeout(() => {
      store.searchTranscripts(q).then((hits) => live && setFound({ q, hits: new Map(hits.map((h) => [`${h.profile}:${h.id}`, h.snippet])) }), () => {});
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, store]);
  return found.q === q ? found.hits : NO_HITS;
}

export const MeetingRow = memo(function MeetingRow({ m, now, topics = NO_TOPICS, said }: { m: Meeting; now: number; topics?: string[]; said?: string }) {
  const snap = useAssistantData();
  const count = actionCounts(snap.items).get(meetingKey(m)) ?? actionCount([], m);
  return <MeetingRowView m={m} now={now} topics={topics} said={said} review={count.review} total={count.total} done={count.done} />;
});

const MeetingRowView = memo(function MeetingRowView({ m, now, topics, said, review, total, done }: { m: Meeting; now: number; topics: string[]; said?: string; review: number; total: number; done: number }) {
  const tracked = useMemo(() => trackedTopics(m, topics), [m, topics]);
  const people = useMemo(() => peopleOf(m), [m]);
  const live = m.starts_at! <= now && (m.ends_at ?? m.starts_at!) > now;
  const soon = !live && m.starts_at! > now && m.starts_at! - now < 3 * 3600_000;
  const mins = Math.round((m.starts_at! - now) / 60000);
  return (
    <button className={`mt-row${(m.ends_at ?? m.starts_at!) <= now ? ' past' : ''}`} onClick={() => openMeeting(m)}>
      <span className="mt-tile"><Icon name={m.id.startsWith('cal:') ? 'calendar' : 'edit'} /></span>
      <span className="mt-body">
        <span className="mt-title"><ProfileDot profile={m.profile} />{m.title}{live && <span className="mt-badge live">Now</span>}{soon && <span className="mt-badge">in {mins < 60 ? `${mins} min` : `${Math.round(mins / 60)} h`}</span>}</span>
        <span className="mt-span">
          {m.starts_at! >= dayEnd(now) && `${dayLabel(m.starts_at!, true)}, `}
          {clock(m.starts_at!)}{m.ends_at ? ` - ${clock(m.ends_at)}` : ''}
          {m.recorded_ms ? ` · ${Math.round(m.recorded_ms / 60000)} min recorded` : ''}
        </span>
        {said && <span className="mt-said" title="From the transcript">{said}</span>}
      </span>
      {tracked.map((t) => <span key={t} className="chip pill sm" title="Tracked topic">{t}</span>)}
      <Badge m={m} now={now} review={review} total={total} done={done} />
      <Avatars people={people} />
    </button>
  );
});


// Today, then each later day with meetings, one at a time, like a desk calendar.
function Upcoming({ meetings, now, topics }: { meetings: Meeting[]; now: number; topics: string[] }) {
  const [picked, setPicked] = useState(0);
  const days = useMemo(() => {
    const today = dayStart(now);
    const out = new Map<number, Meeting[]>([[today, []]]);
    for (const m of live(meetings).filter((x) => x.starts_at != null && (x.ends_at ?? x.starts_at) > now).sort((a, b) => a.starts_at! - b.starts_at!)) {
      const d = Math.max(today, dayStart(m.starts_at!));
      out.set(d, [...(out.get(d) ?? []), m]);
    }
    return [...out];
  }, [meetings, now]);
  const next = days.findIndex(([d]) => d >= picked);
  const i = next < 0 ? days.length - 1 : next;
  const [day, rows] = days[i];
  const isToday = day === dayStart(now);
  return (
    <section className="mt-upcoming">
      <div className="mt-up-head">
        <span>Upcoming</span>
        <span className="spacer" />
        <button className="icon-btn" title="Earlier day" aria-label="Earlier day" disabled={i === 0} onClick={() => setPicked(days[i - 1][0])}><Icon name="chevron-left" small /></button>
        <button className="icon-btn" title="Next day with meetings" aria-label="Next day" disabled={i === days.length - 1} onClick={() => setPicked(days[i + 1][0])}><Icon name="chevron-right" small /></button>
      </div>
      <div className="mt-up-card">
        <div className="mt-up-date">
          <b>{new Date(day).getDate()}</b>
          <span>{isToday ? 'Today' : new Date(day).toLocaleDateString([], { weekday: 'short', month: 'short' })}</span>
          {isToday && <i className="mt-up-dot" />}
        </div>
        <div className="mt-up-rows">
          {rows.map((m) => <MeetingRow key={m.profile + m.id} m={m} now={now} topics={topics} />)}
          {!rows.length && <div className="mt-up-none">{days.length > 1 ? 'Nothing else today.' : 'Nothing on the calendar.'}</div>}
        </div>
      </div>
    </section>
  );
}

function TopicBar({ topics, active, fresh, onToggle, onAdd, onRemove }: { topics: string[]; active: string[]; fresh: Record<string, number>; onToggle: (t: string) => void; onAdd: (t: string) => void; onRemove: (t: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="mt-topics">
      {topics.map((t) => (
        <span key={t} className="mt-topic">
          <button className={`chip pill${active.includes(t) ? '' : ' outline'}`} aria-pressed={active.includes(t)} title="Show only meetings on this topic" onClick={() => onToggle(t)}>{t}{fresh[t] > 0 && <span className="mt-topic-new" title={`${fresh[t]} new since your last visit`}>{fresh[t]}</span>}</button>
          <button className="icon-btn" title={`Stop tracking ${t}`} aria-label={`Stop tracking ${t}`} onClick={() => onRemove(t)}><Icon name="close" small /></button>
        </span>
      ))}
      <form onSubmit={(e) => { e.preventDefault(); onAdd(text.trim().toLowerCase()); setText(''); }}>
        <input value={text} placeholder="Track a topic" aria-label="Track a topic" onChange={(e) => setText(e.target.value)} />
      </form>
    </div>
  );
}

function TopicTimeline({ topic, meetings, facts }: { topic: string; meetings: Meeting[]; facts: Fact[] }) {
  const { entries } = useMemo(() => topicTimeline(topic, meetings, facts), [topic, meetings, facts]);
  const questions = useMemo(() => openQuestions(meetings).filter(rowMatcher<Question>(queryWords(topic), 'question', (q) => [q.text, q.meeting.title])), [topic, meetings]);
  if (!entries.length && !questions.length) return null;
  return (
    <>
      <OpenQuestions questions={questions} />
      <section className="mt-tl">
        {entries.map((e, i) => (
          <button key={i} className="mt-log-item mt-tl-item" onClick={() => (e.meeting ? openMeeting(e.meeting) : setView({ list: 'wiki', open: e.fact?.page_id ?? null, anchor: null }))}>
            <Icon name={e.kind === 'claim' ? 'book' : e.kind === 'decision' ? 'check' : 'calendar'} small />
            <span className="mt-log-text">{e.text}</span>
            <span className="mt-log-from">{when(e.at)}</span>
          </button>
        ))}
      </section>
    </>
  );
}

export function MeetingsList({ onMenu }: { onMenu: () => void }) {
  const pull = usePullSync();
  const { meetings, facts, store } = useCodex();
  const { filter } = useView();
  const [query, setQuery] = useState('');
  const [topics, setTopics] = useState(() => stored<string[]>(TOPICS_KEY, []).filter((t) => typeof t === 'string'));
  const [active, setActive] = useState<string[]>([]);
  const [seen, setSeen] = useState(() => stored<Record<string, number>>(SEEN_KEY, {}));
  const [log, setLog] = useState(false);
  const [load, setLoad] = useState(false);
  const [week, setWeek] = useState(false);
  const changeTopics = (next: string[]) => {
    setTopics(next);
    setActive((a) => a.filter((t) => next.includes(t)));
    save(TOPICS_KEY, next);
  };
  const mine = useMemo(() => (filter === 'all' ? meetings : meetings.filter((m) => m.profile === filter)), [meetings, filter]);
  const myFacts = useMemo(() => (filter === 'all' ? facts : facts.filter((f) => f.profile === filter)), [facts, filter]);
  const fresh = useMemo(() => Object.fromEntries(topics.map((t) => [t, topicTimeline(t, mine, myFacts, seen[t] ?? 0).fresh])), [topics, mine, myFacts, seen]);
  const markSeen = (t: string) => {
    const next = { ...seen, [t]: Date.now() };
    setSeen(next);
    save(SEEN_KEY, next);
  };
  const addTopic = (t: string) => {
    if (!t || topics.includes(t)) return;
    markSeen(t);
    changeTopics([...topics, t]);
  };
  const removeTopic = (t: string) => {
    const { [t]: _gone, ...rest } = seen;
    setSeen(rest);
    save(SEEN_KEY, rest);
    changeTopics(topics.filter((x) => x !== t));
  };
  const toggle = (t: string) => {
    if (!active.includes(t)) markSeen(t);
    setActive((a) => (a.includes(t) ? a.filter((x) => x !== t) : [...a, t]));
  };
  const [syncing, runSync] = useSnackTask();
  const now = useMinute();
  const said = useTranscriptHits(query);
  const found = useMemo(() => {
    const tracked = active.length ? mine.filter((m) => trackedTopics(m, active).length) : mine;
    return searchMeetings(tracked, query, said);
  }, [mine, query, active, said]);
  const groups = useMemo(() => groupMeetings(found, now), [found, now]);
  const total = useMemo(() => groups.reduce((n, g) => n + g.rows.length, 0), [groups]);
  const [shown, more] = useWindow(`${filter}|${query}|${active.join(',')}`);
  const visible = useMemo(() => capGroups(groups, shown, 'rows'), [groups, shown]);
  const takeNotes = () => {
    const t = Date.now();
    const id = newId();
    const row: Meeting = {
      id, profile: filter === 'personal' ? 'personal' : 'work', version: 0, updated_at: t, deleted: 0, dirty: 1, field_times: '{}',
      title: 'Notes', starts_at: t, ends_at: null, people: null, calendar_url: null, recorded_ms: null, notes: '', summary: null, decisions: null, transcript: null, tries: null, room: null, room_me: null, others: null,
    };
    void store.editRow('meetings', row, { title: 'Notes', starts_at: t, notes: '' });
    setView({ open: meetingKey(row) });
  };
  const syncCalendar = () => runSync(async () => {
    const n = await store.syncCalendar();
    showSnack(n ? `${n} meeting${n > 1 ? 's' : ''} updated from the calendar` : 'Calendar is up to date');
  }, 'Calendar sync failed');
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <button className="icon-btn as-menu" title="Lists" aria-label="Lists" onClick={onMenu}><Icon name="menu" /></button>
        <h1>Meetings</h1>
        <span className="spacer" />
        <label className="wk-search">
          <Icon name="search" small />
          <input enterKeyHint="search" value={query} placeholder="Search" aria-label="Search meetings" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
        </label>
        <button className={`btn mt-dec${log ? ' on' : ''}`} aria-pressed={log} title="Decisions from all meetings" onClick={() => { setLog((v) => !v); setLoad(false); setWeek(false); }}><Icon name="check" small /> <span>Decisions</span></button>
        <button className={`btn mt-dec${load ? ' on' : ''}`} aria-pressed={load} title="Hours in meetings per week" onClick={() => { setLoad((v) => !v); setLog(false); setWeek(false); }}><Icon name="graph" small /> <span>Load</span></button>
        <button className={`btn mt-dec${week ? ' on' : ''}`} aria-pressed={week} title="This week in review" onClick={() => { setWeek((v) => !v); setLog(false); setLoad(false); }}><Icon name="calendar" small /> <span>Week</span></button>
        <button className="btn mt-cal" disabled={syncing} title="Import the next days from Google Calendar (runs on its own every half hour from 7 to 19 on weekdays, and when the app opens)" onClick={syncCalendar}>
          <Icon name={syncing ? 'loading' : 'sync'} small spin={syncing} /> <span>{syncing ? 'Syncing' : 'Sync calendar'}</span>
        </button>
        <button className="btn primary mt-take" onClick={takeNotes}><Icon name="edit" small /> <span>Take notes</span></button>
      </header>
      {pull.indicator}
      <div className="wk-scroll" ref={pull.ref}>
        {log ? <Decisions meetings={mine} /> : load ? <Load meetings={mine} now={now} /> : week ? <Week meetings={mine} facts={myFacts} now={now} /> : <div className="mt-list">
          <TopicBar topics={topics} active={active} fresh={fresh} onToggle={toggle}
            onAdd={addTopic} onRemove={removeTopic} />
          {active.length === 1 && <TopicTimeline topic={active[0]} meetings={mine} facts={myFacts} />}
          {!query && <Upcoming meetings={mine} now={now} topics={topics} />}
          {visible.map((g) => (
            <section key={g.label}>
              <div className="mt-day">{g.label}</div>
              <div className="mt-days">{g.rows.map((m) => <MeetingRow key={m.profile + m.id} m={m} now={now} topics={topics} said={said.get(meetingKey(m))} />)}</div>
            </section>
          ))}
          <ShowMore shown={shown} total={total} onMore={more} />
          {!groups.length && <div className="as-empty"><Icon name="calendar" /><div>{query ? 'No meetings match.' : 'No past meetings yet.'}</div><div className="muted small">{query ? 'Search covers titles, people, notes, summaries, decisions and transcripts.' : 'Coming meetings are in Today and Upcoming.'}</div></div>}
        </div>}
      </div>
    </div>
  );
}
