import { useMemo, useRef, useState } from 'react';
import { useCodex } from '../data';
import { rowKey } from '../data/sync';
import { Icon } from '../../ui/Icon';
import { Button, Chip } from '../../ui/Button';
import { EmptyState } from '../../ui/Panel';
import { Section } from '../../ui/Section';
import { ShowMore } from '../../ui/useWindow';
import { setView, takeWeekReturn, useSpotBack, useView } from '../view';
import { Decisions } from './Decisions';
import { Load } from './Load';
import { Week } from './Week';
import { usePullRefresh } from '../gestures/usePullRefresh';
import { useMinute } from '../tasks/split';
import { ComingDays } from './list/ComingDays';
import { ListMenu, type ListMode } from './list/ListMenu';
import { MeetingRow } from './list/MeetingRow';
import { TopicBar, TopicTimeline } from './list/Topics';
import { useMeetingChips } from './list/useMeetingChips';
import { useMeetingResults } from './list/useMeetingResults';
import { useMeetingTopics } from './list/useMeetingTopics';
import '../../styles/features/wiki.css';
import '../../styles/features/meetings.css';

export function MeetingsList({ onMenu }: { onMenu: () => void }) {
  const { meetings, facts, store } = useCodex();
  const pullRef = useRef<HTMLDivElement>(null);
  const ptr = usePullRefresh(pullRef, () => Promise.all([store.syncNow(), store.syncCalendar()]), true);
  useSpotBack(pullRef, 'meetings');
  const { filter } = useView();
  const [query, setQuery] = useState('');
  const [topicBar, setTopicBar] = useState(false);
  const [mode, setMode] = useState<ListMode>(() => (takeWeekReturn() ? 'week' : ''));
  const mine = useMemo(() => (filter === 'all' ? meetings : meetings.filter((m) => m.profile === filter)), [meetings, filter]);
  const myFacts = useMemo(() => (filter === 'all' ? facts : facts.filter((f) => f.profile === filter)), [facts, filter]);
  const { topics, active, fresh, addTopic, removeTopic, toggleTopic } = useMeetingTopics(mine, myFacts);
  const { chips, setFilters, toggleChip } = useMeetingChips();
  const now = useMinute();
  const { said, groups, total, shown, more, visible } = useMeetingResults(mine, query, chips, active, now);
  const trackTopic = () => {
    if (topicBar && !active.length) return setTopicBar(false);
    setTopicBar(true);
    setTimeout(() => pullRef.current?.querySelector<HTMLInputElement>('.mt-topics input')?.focus());
  };
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
        <ListMenu mode={mode} setMode={setMode} chips={chips} toggleChip={toggleChip} trackTopic={trackTopic} />
      </header>
      <div className="as-ptr" ref={ptr} aria-hidden><Icon name="refresh" /></div>
      <div className="wk-scroll" ref={pullRef}>
        {mode === 'log' ? <Decisions meetings={mine} /> : mode === 'load' ? <Load meetings={mine} now={now} /> : mode === 'week' ? <Week meetings={mine} facts={myFacts} now={now} /> : <div className="mt-page mt-page-list">
          {chips.length > 0 && (
            <div className="mt-chips" role="group" aria-label="Filters">
              {chips.map((c) => <Chip key={c} on aria-pressed onClick={() => toggleChip(c)}>{c}</Chip>)}
            </div>
          )}
          {(active.length > 0 || topicBar) && <TopicBar topics={topics} active={active} fresh={fresh} onToggle={toggleTopic}
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
