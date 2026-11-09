import { useMemo, useRef, useState } from 'react';
import { useAssistantData, useCodex } from '../data';
import { dayLabel } from '../data/dates';
import { cadenceOf, meetingState, nextInSeries, parseSeriesKey, seriesMeetings, seriesPeople } from '../data/meetings/meetings';
import { NOTES_TEMPLATES, notesTemplateChips, rememberNotesTemplate, type NotesTemplate } from '../data/meetings/notesTemplates';
import type { ItemRow } from '../data/sync';
import { listOf, type Meeting } from '../data/wiki/wiki';
import { Icon } from '../../ui/Icon';
import { EmptyState } from '../../ui/Panel';
import { Button, IconButton } from '../../ui/Button';
import { Menu, MenuItem } from '../../ui/Menu';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { plural, safeHref } from '../../ui/util';
import { clock } from '../tasks/time';
import { useMinute } from '../tasks/split';
import { Capped } from '../Fold';
import { openMeeting, setView, showSnack, useEscapeBack } from '../view';
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
  const next = useMemo(() => nextInSeries(meetings, profile, title, now), [meetings, profile, title, now]);
  const cadence = useMemo(() => cadenceOf(members), [members]);
  const people = useMemo(() => seriesPeople(members), [members]);
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const calendar = safeHref(next?.calendar_url || members[0]?.calendar_url);
  const cycleTemplate = () => {
    const keys = Object.keys(NOTES_TEMPLATES) as NotesTemplate[];
    const current = notesTemplateChips(members[0]).find((c) => c.selected)?.key ?? 'one_on_one';
    const pick = keys[(keys.indexOf(current) + 1) % keys.length];
    rememberNotesTemplate(members[0], pick);
    setMenu(false);
    showSnack(`Notes template: ${NOTES_TEMPLATES[pick].label}`);
  };
  const openCount = (m: Meeting) => open.filter((x) => x.m === m).length;
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <button className="icon-btn" title="Back" aria-label="Back" onClick={back}><Icon name="arrow-left" /></button>
        <nav className="wk-crumbs"><button onClick={back}>Meetings</button></nav>
      </header>
      <div className="wk-scroll">
        <article className="mt-page">
          {!members.length ? <EmptyState size="md" title="No meetings" /> : (
            <>
              <Section label={members[0].title} action={(
                <>
                  {next && <Button variant="filled" size="sm" onClick={() => openMeeting(next)}>Open next</Button>}
                  <span className="mt-series-more"><IconButton ref={more} icon="kebab-vertical" label="More" size="sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
                    {menu && (
                      <Menu trigger={more} onClose={() => setMenu(false)}>
                        {calendar && <MenuItem icon="calendar" href={calendar} onClick={() => setMenu(false)}>Open calendar</MenuItem>}
                        <MenuItem icon="edit" onClick={cycleTemplate}>Notes template</MenuItem>
                      </Menu>
                    )}
                  </span>
                </>
              )} />
              <div className="mt-chips">
                {cadence && <span className="chip">{cadence}</span>}
                {people.length > 0 && <span className="chip">{people.length === 1 ? '1 person' : `${people.length} people`}</span>}
              </div>
              <section className="mt-sec">
                <h2>Open across the series</h2>
                {open.length ? <div className="mt-tasks"><Capped items={open} render={({ m, r }) => (
                  <div key={r.profile + r.id}>
                    <ActionRow row={r} meeting={m} />
                    <button className="mt-person mt-series-from" onClick={() => openMeeting(m)}>{day(m)}</button>
                  </div>
                )} /></div> : <EmptyState size="sm" title="Nothing open" />}
              </section>
              <section className="mt-sec">
                <Section label="Occurrences" count={members.length} />
                <div className="as-group">
                  <Capped items={members} render={(m) => {
                    const decisions = listOf(m.decisions).length;
                    const left = openCount(m);
                    const meta = [decisions > 0 && plural(decisions, 'decision'), left > 0 && `${left} open`].filter(Boolean).join(', ');
                    return <Row key={m.profile + m.id} className={meetingState(m, now) === 'missing' ? 'mt-occ muted' : 'mt-occ'} title={`${day(m)}, ${clock(m.starts_at!)}`} meta={meta || undefined} onClick={() => openMeeting(m)} />;
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
