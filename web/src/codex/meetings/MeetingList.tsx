import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useAssistantData, useAssistantStore, useCodex } from '../data';
import { newId, rowKey } from '../data/sync';
import { live, queryWords, rowMatcher, type Fact, type Meeting } from '../data/wiki';
import { MEETING_CHIPS, filterMeetings, groupMeetings, meetingBadge, meetingMeta, openQuestions, searchMeetings, topicTimeline, trackedTopics, type MeetingChip, type Question } from '../data/meetings';
import { when } from '../time';
import { dayEnd, dayLabel, dayStart } from '../data/dates';
import { Icon } from '../../ui/Icon';
import { Button, Chip, IconButton } from '../../ui/Button';
import { EmptyState } from '../../ui/Panel';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { Row } from '../../ui/Row';
import { Section, sectionCount } from '../../ui/Section';
import { safeHref, save, stored, storedStrings } from '../../ui/util';
import { ShowMore, capGroups, useWindow } from '../../ui/useWindow';
import { openMeeting, openMeetingNotes, setView, showSnack, takeWeekReturn, useSpotBack, useView } from '../view';
import { ProfileDot } from '../ProfileDot';
import { Decisions } from './Decisions';
import { Load } from './Load';
import { OpenQuestions } from './OpenQuestions';
import { Week } from './Week';
import { usePullRefresh } from '../usePullRefresh';
import { useSnackTask } from '../useSnackTask';
import { useMinute } from '../split';
import '../../styles/features/wiki.css';
import '../../styles/features/meetings.css';
import { Badge } from '../../ui/Badge';

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const TOPICS_KEY = 'agentview.meetingTopics';
const CHIPS_KEY = 'agentview.meetingFilters';
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

const MODES: ['log' | 'load' | 'week', string, string][] = [['log', 'Decisions', 'check'], ['load', 'Load', 'graph'], ['week', 'Week', 'calendar']];

const NO_HITS = new Map<string, string>();

// What the hub finds in the transcripts of the filter's profiles for the query, by profile:id with a snippet; empty until it answers.
export function useTranscriptHits(query: string) {
  const store = useAssistantStore();
  const { filter } = useView();
  const [found, setFound] = useState({ q: '', hits: NO_HITS });
  const text = query.trim();
  const profile = filter === 'all' ? undefined : filter;
  const q = `${filter}|${text}`;
  useEffect(() => {
    if (!text) return;
    let live = true;
    const t = setTimeout(() => {
      store.searchTranscripts(text, profile).then((hits) => live && setFound({ q, hits: new Map(hits.map((h) => [`${h.profile}:${h.id}`, h.snippet])) }), () => {});
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, text, profile, store]);
  return found.q === q ? found.hits : NO_HITS;
}

export const MeetingRow = memo(function MeetingRow({ m, now, said, noDay }: { m: Meeting; now: number; said?: string; noDay?: boolean }) {
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const badge = meetingBadge(m, now);
  const calendar = m.id.startsWith('cal:') ? safeHref(m.calendar_url) : undefined;
  const pick = (act: () => void) => () => { setMenu(false); act(); };
  const open = () => openMeeting(m);
  const moreBtn = (
    <span className="mt-more" onClick={(e) => e.stopPropagation()}>
      <IconButton ref={more} size="sm" icon="kebab-vertical" label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
      {menu && (
        <Menu trigger={more} onClose={() => setMenu(false)}>
          {calendar && <MenuItem icon="calendar" href={calendar} onClick={() => setMenu(false)}>Open calendar</MenuItem>}
          <MenuItem icon="edit" onClick={pick(() => openMeetingNotes(m))}>Notes</MenuItem>
        </Menu>
      )}
    </span>
  );
  return (
    <Row
      plain
      role="button"
      tabIndex={0}
      className={(m.ends_at ?? m.starts_at!) <= now ? 'past' : undefined}
      title={<><ProfileDot profile={m.profile} />{m.title}</>}
      meta={said ? <span className="mt-said" title="From the transcript">{said}</span> : meetingMeta(m, now, noDay)}
      trailing={<>{badge && <Badge status="running" label={badge} />}{moreBtn}</>}
      onClick={open}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } }}
    />
  );
});


// The coming week grouped by day, so the next working morning sits at the top.
function ComingDays({ meetings, now }: { meetings: Meeting[]; now: number }) {
  const days = useMemo(() => {
    const today = dayStart(now), end = today + 7 * 86400_000;
    const out = new Map<number, Meeting[]>();
    for (const m of live(meetings).filter((x) => x.starts_at != null && (x.ends_at ?? x.starts_at) > now && x.starts_at < end).sort((a, b) => a.starts_at! - b.starts_at!)) {
      const d = Math.max(today, dayStart(m.starts_at!));
      out.set(d, [...(out.get(d) ?? []), m]);
    }
    return [...out];
  }, [meetings, now]);
  const label = (d: number) => d === dayStart(now) ? 'Today' : d === dayEnd(now) ? 'Tomorrow' : dayLabel(d, true);
  return (
    <>
      {days.map(([d, rows]) => (
        <section key={d}>
          <Section label={label(d)} count={sectionCount(rows.length)} />
          <div className="as-group">{rows.map((m) => <MeetingRow key={m.profile + m.id} m={m} now={now} noDay />)}</div>
        </section>
      ))}
      {!days.length && <EmptyState size="sm" icon="calendar" title="Nothing on the calendar this week" />}
    </>
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
      <section>
        {entries.map((e, i) => (
          <Row
            key={i}
            leading={<Icon name={e.kind === 'claim' ? 'book' : e.kind === 'decision' ? 'check' : 'calendar'} small />}
            title={e.text}
            trailing={when(e.at)}
            onClick={() => (e.meeting ? openMeeting(e.meeting) : setView({ list: 'wiki', open: e.fact?.page_id ?? null, anchor: null }))}
          />
        ))}
      </section>
    </>
  );
}

export function MeetingsList({ onMenu }: { onMenu: () => void }) {
  const { meetings, facts, store } = useCodex();
  const snap = useAssistantData();
  const pullRef = useRef<HTMLDivElement>(null);
  const ptr = usePullRefresh(pullRef, () => Promise.all([store.syncNow(), store.syncCalendar()]), true);
  useSpotBack(pullRef, 'meetings');
  const { filter } = useView();
  const [query, setQuery] = useState('');
  const [topics, setTopics] = useState(() => stored<string[]>(TOPICS_KEY, []).filter((t) => typeof t === 'string'));
  const [active, setActive] = useState<string[]>([]);
  const [seen, setSeen] = useState(() => stored<Record<string, number>>(SEEN_KEY, {}));
  const [chips, setChips] = useState(() => MEETING_CHIPS.filter((c) => storedStrings(CHIPS_KEY).includes(c)));
  const [menu, setMenu] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const [topicBar, setTopicBar] = useState(false);
  const [mode, setMode] = useState<'' | 'log' | 'load' | 'week'>(() => (takeWeekReturn() ? 'week' : ''));
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
  const setFilters = (next: MeetingChip[]) => {
    setChips(next);
    save(CHIPS_KEY, next);
  };
  const toggleChip = (c: MeetingChip) => setFilters(chips.includes(c) ? chips.filter((x) => x !== c) : MEETING_CHIPS.filter((x) => x === c || chips.includes(x)));
  const toggle = (t: string) => {
    if (!active.includes(t)) markSeen(t);
    setActive((a) => (a.includes(t) ? a.filter((x) => x !== t) : [...a, t]));
  };
  const now = useMinute();
  const said = useTranscriptHits(query);
  const found = useMemo(() => {
    const filtered = filterMeetings(mine, snap.items, chips, now);
    const tracked = active.length ? filtered.filter((m) => trackedTopics(m, active).length) : filtered;
    return searchMeetings(tracked, query, said);
  }, [mine, snap.items, chips, now, query, active, said]);
  const groups = useMemo(() => groupMeetings(found, now), [found, now]);
  const total = useMemo(() => groups.reduce((n, g) => n + g.rows.length, 0), [groups]);
  const [shown, more] = useWindow(`${filter}|${query}|${active.join(',')}|${chips.join(',')}`);
  const visible = useMemo(() => capGroups(groups, shown, 'rows'), [groups, shown]);
  const takeNotes = () => {
    const t = Date.now();
    const id = newId();
    const row: Meeting = {
      id, profile: filter === 'personal' ? 'personal' : 'work', version: 0, updated_at: t, deleted: 0, dirty: 1, field_times: '{}',
      title: 'Notes', starts_at: t, ends_at: null, people: null, calendar_url: null, recorded_ms: null, notes: '', summary: null, decisions: null, transcript: null, tries: null, room: null, room_me: null, organizer_me: null, others: null,
    };
    void store.editRow('meetings', row, { title: 'Notes', starts_at: t, notes: '' });
    setView({ open: rowKey(row) });
  };
  const pick = (act: () => void) => () => { setMenu(false); act(); };
  const trackTopic = () => {
    if (topicBar && !active.length) return setTopicBar(false);
    setTopicBar(true);
    setTimeout(() => pullRef.current?.querySelector<HTMLInputElement>('.mt-topics input')?.focus());
  };
  const [syncing, runSync] = useSnackTask();
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
        <span className="mt-head-more">
          <IconButton ref={moreBtn} size="sm" icon="kebab-vertical" label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
          {menu && (
            <Menu trigger={moreBtn} onClose={() => setMenu(false)}>
              {MODES.map(([m, label, icon]) => <MenuItem key={m} icon={mode === m ? 'check' : icon} onClick={pick(() => setMode(mode === m ? '' : m))}>{label}</MenuItem>)}
              <MenuItem icon="edit" onClick={pick(takeNotes)}>Take notes</MenuItem>
              <MenuItem icon={syncing ? 'loading' : 'sync'} spin={syncing} disabled={syncing} onClick={pick(syncCalendar)}>Sync calendar</MenuItem>
              <MenuSeparator />
              {MEETING_CHIPS.map((c) => <MenuItem key={c} role="menuitemcheckbox" aria-checked={chips.includes(c)} icon={chips.includes(c) ? 'check' : undefined} onClick={pick(() => toggleChip(c))}>{c}</MenuItem>)}
              <MenuSeparator />
              <MenuItem onClick={pick(trackTopic)}>Track a topic</MenuItem>
            </Menu>
          )}
        </span>
      </header>
      <div className="as-ptr" ref={ptr} aria-hidden><Icon name="refresh" /></div>
      <div className="wk-scroll" ref={pullRef}>
        {mode === 'log' ? <Decisions meetings={mine} /> : mode === 'load' ? <Load meetings={mine} now={now} /> : mode === 'week' ? <Week meetings={mine} facts={myFacts} now={now} /> : <div className="mt-page mt-page-list">
          {chips.length > 0 && (
            <div className="mt-chips" role="group" aria-label="Filters">
              {chips.map((c) => <Chip key={c} on aria-pressed onClick={() => toggleChip(c)}>{c}</Chip>)}
            </div>
          )}
          {(active.length > 0 || topicBar) && <TopicBar topics={topics} active={active} fresh={fresh} onToggle={toggle}
            onAdd={addTopic} onRemove={removeTopic} />}
          {active.length === 1 && <TopicTimeline topic={active[0]} meetings={mine} facts={myFacts} />}
          {!query && !chips.length && <ComingDays meetings={mine} now={now} />}
          {visible.map((g) => (
            <section key={g.label}>
              <Section label={g.label} />
              <div className="as-group">{g.rows.map((m) => <MeetingRow key={m.profile + m.id} m={m} now={now} said={said.get(rowKey(m))} />)}</div>
            </section>
          ))}
          <ShowMore shown={shown} total={total} onMore={more} />
          {!groups.length && chips.length > 0 && <EmptyState size="md" icon="calendar" title="No meetings match" hint="Try fewer filters" action={<Button size="sm" onClick={() => setFilters([])}>Clear filters</Button>} />}
          {!groups.length && !chips.length && <EmptyState size="md" icon="calendar" title={query ? 'No meetings match' : 'No past meetings yet'} hint={query ? 'Search covers titles, people, notes, summaries, decisions and transcripts' : 'Coming meetings are listed by day'} />}
        </div>}
      </div>
    </div>
  );
}
