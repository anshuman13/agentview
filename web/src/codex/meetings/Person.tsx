import { useAssistantData, useCodex } from '../data';
import { claimsMentioning, commitmentsOf, meetingsOf, openQuestions, pinsOf } from '../data/wiki';
import { PinList } from './Pins';
import { Icon } from '../../ui/Icon';
import { setView, useEscapeBack } from '../view';
import { Avatars, MeetingRow } from './Meetings';
import { OpenQuestions } from './OpenQuestions';
import '../../styles/features/wiki.css';

export function Person({ name }: { name: string }) {
  const { meetings, facts, pages } = useCodex();
  const snap = useAssistantData();
  const back = () => setView({ person: null });
  useEscapeBack(back);
  const mine = meetingsOf(meetings, name);
  const pins = pinsOf(snap.items, mine);
  const commitments = commitmentsOf(meetings, name);
  const claims = claimsMentioning(facts, name);
  const questions = openQuestions(mine);
  const title = new Map(pages.map((p) => [p.id, p.title]));
  const now = Date.now();
  const open = (key: string) => setView({ person: null, list: 'meetings', open: key });
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <button className="icon-btn" title="Back" aria-label="Back" onClick={back}><Icon name="arrow-left" /></button>
        <nav className="wk-crumbs"><button onClick={back}>Back</button></nav>
      </header>
      <div className="wk-scroll">
        <article className="mt-page">
          <div className="mt-person-head"><Avatars people={[name]} /><h1 className="wk-title">{name}</h1></div>
          <div className="wk-meta mt-when"><span>{mine.length} meeting{mine.length === 1 ? '' : 's'}</span></div>

          <section className="mt-sec">
            <h2>Commitments<span className="mt-of">{commitments.length}</span></h2>
            {commitments.length > 0 ? (
              <ul className="wk-claims">
                {commitments.map((c, i) => (
                  <li key={i} className="wk-claim">
                    <span className="wk-claim-text">{c.what}</span>
                    <span className="wk-claim-foot"><button className="mt-person" onClick={() => open(`${c.meeting.profile}:${c.meeting.id}`)}>{c.meeting.title}</button></span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-pending">Nothing recorded for {name}.</p>}
          </section>

          <OpenQuestions questions={questions} />

          {pins.length > 0 && (
            <section className="mt-sec">
              <h2>Pinned<span className="mt-of">{pins.length}</span></h2>
              <PinList pins={pins} onOpen={(r) => open(`${r.profile}:${r.meeting_id}`)} />
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
