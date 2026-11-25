import { useEffect, useMemo, useRef, useState } from 'react';
import { useAssistantData, useCodex } from './data';
import { GROUP_CAP, searchAll, type Group, type Hit } from './data/ask/search';
import { ShowAll } from '../ui/Button';
import { EmptyState } from '../ui/Panel';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { openMeeting, openMeetingAt, openTask, setView, takeSearchQuery, useView } from './view';
import { useScrolledHeader } from './gestures/usePullRefresh';
import { CodexHead } from './CodexHead';
import { useTranscriptHits } from './meetings/list/useTranscriptHits';
import { live } from './data/wiki/wiki';
import { dayLabel } from './data/dates';
import '../styles/features/wiki.css';
import '../styles/features/meetings.css';

function Hits({ label, group, open, onAll, said }: { label: string; group: Group; open: (h: Hit) => void; onAll: () => void; said?: boolean }) {
  if (!group.total) return null;
  return (
    <section>
      <Section label={label} count={group.total} />
      <div className="ui-group sr-hits">
        {group.hits.map((h) => (
          <Row key={h.profile + h.id} className={said ? 'sr-said' : undefined} title={h.title} meta={[h.profile === 'work' ? 'Work' : 'Personal', h.when, h.snippet].filter(Boolean).join(' \u00b7 ')} onClick={() => open(h)} />
        ))}
      </div>
      {group.total > group.hits.length && <ShowAll count={group.total} onClick={onAll} />}
    </section>
  );
}

export function Search({ onMenu }: { onMenu: () => void }) {
  const snap = useAssistantData();
  const { meetings } = useCodex();
  const { filter } = useView();
  const scroller = useRef<HTMLDivElement>(null);
  useScrolledHeader(scroller, true);
  const [query, setQuery] = useState(takeSearchQuery);
  const [expanded, setExpanded] = useState<string[]>([]);
  useEffect(() => setExpanded([]), [query]);
  const more = (g: string) => () => setExpanded((e) => [...e, g]);
  const r = useMemo(() => {
    const keep = <T extends { profile: string }>(rows: T[]) => rows.filter((x) => filter === 'all' || x.profile === filter);
    return searchAll({ items: keep(snap.items), meetings: keep(meetings), facts: keep(snap.facts), pages: keep(snap.pages), jobs: keep(snap.jobs) }, query, expanded);
  }, [snap.items, meetings, snap.facts, snap.pages, snap.jobs, filter, query, expanded]);
  const said = useTranscriptHits(query);
  const transcripts = useMemo((): Group => {
    const byKey = new Map(live(meetings).filter((m) => filter === 'all' || m.profile === filter).map((m) => [`${m.profile}:${m.id}`, m]));
    const hits = [...said].flatMap(([k, text]): Hit[] => {
      const m = byKey.get(k);
      return m ? [{ id: m.id, profile: m.profile, title: m.title || 'Meeting', snippet: text, when: m.starts_at ? dayLabel(m.starts_at) : undefined }] : [];
    });
    return { hits: expanded.includes('transcripts') ? hits : hits.slice(0, GROUP_CAP), total: hits.length };
  }, [said, meetings, filter, expanded]);
  const key = (h: Hit) => `${h.profile}:${h.id}`;
  return (
    <div className="wk narrow">
      <CodexHead title="Search" onMenu={onMenu} />
      <div className="wk-scroll" ref={scroller}>
        <div className="mt-page">
          <input autoFocus type="search" enterKeyHint="search" value={query} placeholder="Search tasks, meetings, transcripts, wiki and jobs" aria-label="Search" onChange={(e) => setQuery(e.target.value)} />
          <Hits label="Tasks and notes" group={r.tasks} onAll={more('tasks')} open={(h) => (h.page ? openMeeting({ profile: h.profile, id: h.page }) : openTask(h))} />
          <Hits label="Meetings" group={r.meetings} onAll={more('meetings')} open={openMeeting} />
          <Hits label="Transcripts" group={transcripts} said onAll={more('transcripts')} open={(h) => openMeetingAt(h, query)} />
          <Hits label="Wiki" group={r.wiki} onAll={more('wiki')} open={(h) => setView({ list: 'wiki', open: h.page ?? null, anchor: null })} />
          <Hits label="Jobs" group={r.jobs} onAll={more('jobs')} open={(h) => setView({ list: 'jobs', open: key(h) })} />
          {query.trim() && !r.total && !transcripts.total && <EmptyState size="sm" icon="search" title="No matches" />}
        </div>
      </div>
    </div>
  );
}
