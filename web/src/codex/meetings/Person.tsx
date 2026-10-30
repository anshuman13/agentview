import { useMemo } from 'react';
import { useAssistantData, useCodex } from '../data';
import { personMarkdown } from '../data/meetingMarkdown';
import { claimsMentioning, commitmentsOf, meetingsOf, openQuestions, pinsOf, questionKey } from '../data/wiki';
import { PinList } from './Pins';
import { Icon } from '../../ui/Icon';
import { copyText, openMeeting, setView, useEscapeBack } from '../view';
import { plural } from '../../ui/util';
import { Avatars, MeetingRow } from './Meetings';
import { OpenQuestions, resolvedQuestions } from './OpenQuestions';
import { AddPoint, PointList, useMarkRaised } from './Raise';
import { firstName, pointsOf } from '../data/points';
import '../../styles/features/wiki.css';

export function Person({ name }: { name: string }) {
  const { meetings, facts, pages } = useCodex();
  const snap = useAssistantData();
  const back = () => setView({ person: null });
  useEscapeBack(back);
  useMarkRaised();
  const mine = useMemo(() => meetingsOf(meetings, name), [meetings, name]);
  const points = useMemo(() => pointsOf(snap.items, name), [snap.items, name]);
  const pins = useMemo(() => pinsOf(snap.items, mine), [snap.items, mine]);
  const commitments = useMemo(() => commitmentsOf(meetings, name), [meetings, name]);
  const claims = useMemo(() => claimsMentioning(facts, name), [facts, name]);
  const questions = openQuestions(mine);
  const title = useMemo(() => new Map(pages.map((p) => [p.id, p.title])), [pages]);
  const now = Date.now();
  const copy = () => {
    const resolved = resolvedQuestions();
    const text = personMarkdown(name, { commitments, questions: questions.filter((q) => !resolved.includes(questionKey(q))), pins, meetings: mine, claims });
    copyText(text);
  };
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <button className="icon-btn" title="Back" aria-label="Back" onClick={back}><Icon name="arrow-left" /></button>
        <nav className="wk-crumbs"><button onClick={back}>Back</button></nav>
        <button className="icon-btn" title="Copy as Markdown" aria-label="Copy as Markdown" onClick={copy}><Icon name="copy" /></button>
      </header>
      <div className="wk-scroll">
        <article className="mt-page">
          <div className="mt-person-head"><Avatars people={[name]} /><h1 className="wk-title">{name}</h1></div>
          <div className="wk-meta mt-when"><span>{plural(mine.length, 'meeting')}</span></div>

          <section className="mt-sec">
            <h2>Commitments<span className="mt-of">{commitments.length}</span></h2>
            {commitments.length > 0 ? (
              <ul className="wk-claims">
                {commitments.map((c, i) => (
                  <li key={i} className="wk-claim">
                    <span className="wk-claim-text">{c.what}</span>
                    <span className="wk-claim-foot"><button className="mt-person" onClick={() => openMeeting(c.meeting)}>{c.meeting.title}</button></span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-pending">Nothing recorded for {name}.</p>}
          </section>

          <section className="mt-sec">
            <h2>Raise with {firstName(name)}{points.length > 0 && <span className="mt-of">{points.length}</span>}</h2>
            {points.length > 0 && <PointList points={points} person={false} />}
            <AddPoint person={name} profile={mine[0]?.profile ?? 'work'} />
          </section>

          <OpenQuestions questions={questions} />

          {pins.length > 0 && (
            <section className="mt-sec">
              <h2>Pinned<span className="mt-of">{pins.length}</span></h2>
              <PinList pins={pins} onOpen={(r) => openMeeting({ profile: r.profile, id: r.meeting_id! })} />
            </section>
          )}

          <section className="mt-sec">
            <h2>Meetings</h2>
            {mine.length > 0 ? <div className="mt-rows">{mine.map((m) => <MeetingRow key={m.profile + m.id} m={m} now={now} />)}</div> : <p className="mt-pending">No meetings.</p>}
          </section>

          {claims.length > 0 && (
            <section className="mt-sec">
              <h2>In the wiki<span className="mt-of">{claims.length}</span></h2>
              <ul className="wk-claims">
                {claims.map((f) => (
                  <li key={f.id} className="wk-claim">
                    <span className="wk-claim-text">{f.text}</span>
                    {f.page_id && <span className="wk-claim-foot"><button className="mt-person" onClick={() => setView({ person: null, list: 'wiki', open: f.page_id, anchor: null })}>{title.get(f.page_id)}</button></span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>
      </div>
    </div>
  );
}
