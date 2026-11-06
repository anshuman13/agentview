import { useMemo } from 'react';
import { useAssistantData, useCodex } from '../data';
import { dayLabel } from '../data/dates';
import { meetingState, parseSeriesKey, seriesMeetings } from '../data/meetings';
import type { ItemRow } from '../data/sync';
import { listOf, type Meeting } from '../data/wiki';
import { Icon } from '../../ui/Icon';
import { plural } from '../../ui/util';
import { clock } from '../time';
import { useMinute } from '../split';
import { Capped } from '../Fold';
import { openMeeting, setView, useEscapeBack } from '../view';
import { ActionRow } from './ActionRow';
import '../../styles/features/meetings.css';

const day = (m: Meeting) => dayLabel(m.starts_at!, true);

export function SeriesPage({ series }: { series: string }) {
  const { meetings } = useCodex();
  const snap = useAssistantData();
  const now = useMinute();
  const back = () => setView({ series: null });
  useEscapeBack(back);
  const { profile, title } = parseSeriesKey(series);
  const members = useMemo(() => seriesMeetings(meetings, profile, title, now), [meetings, profile, title, now]);
  const open = useMemo(() => {
    const byMeeting = new Map(members.map((m) => [m.id, [] as ItemRow[]]));
    for (const r of snap.items) if (!r.deleted && r.status === 'open' && r.profile === profile && r.meeting_id) byMeeting.get(r.meeting_id)?.push(r);
    return [...members].reverse().flatMap((m) => byMeeting.get(m.id)!.sort((a, b) => a.updated_at - b.updated_at).map((r) => ({ m, r })));
  }, [members, snap.items, profile]);
  const openCount = (m: Meeting) => open.filter((x) => x.m === m).length;
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <button className="icon-btn" title="Back" aria-label="Back" onClick={back}><Icon name="arrow-left" /></button>
        <nav className="wk-crumbs"><button onClick={back}>Meetings</button></nav>
      </header>
      <div className="wk-scroll">
        <article className="mt-page">
          {!members.length ? <h1 className="wk-title">No meetings</h1> : (
            <>
              <h1 className="wk-title">{members[0].title}</h1>
              <div className="wk-meta mt-when"><span>{plural(members.length, 'meeting')}, {plural(open.length, 'open action')}</span></div>
              <section className="mt-sec">
                <h2>Open across the series</h2>
                {open.length ? <div className="mt-tasks"><Capped items={open} render={({ m, r }) => (
                  <div key={r.profile + r.id}>
                    <ActionRow row={r} meeting={m} />
                    <button className="mt-person mt-series-from" onClick={() => openMeeting(m)}>{day(m)}</button>
                  </div>
                )} /></div> : <p className="mt-pending">Nothing open</p>}
              </section>
              <section className="mt-sec">
                <h2>Occurrences</h2>
                <div className="mt-series-list">
                  <Capped items={members} render={(m) => {
                    const decisions = listOf(m.decisions).length;
                    const left = openCount(m);
                    return (
                      <button key={m.profile + m.id} className={`mt-log-item${meetingState(m, now) === 'missing' ? ' muted' : ''}`} onClick={() => openMeeting(m)}>
                        <span className="mt-log-text">{day(m)}, {clock(m.starts_at!)}</span>
                        {(decisions > 0 || left > 0) && <span className="mt-log-from">{[decisions > 0 && plural(decisions, 'decision'), left > 0 && `${left} open`].filter(Boolean).join(', ')}</span>}
                      </button>
                    );
                  }} />
                </div>
              </section>
            </>
          )}
        </article>
      </div>
    </div>
  );
}
