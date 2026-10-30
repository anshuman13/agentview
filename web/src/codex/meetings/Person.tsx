import { useMemo } from 'react';
import { useAssistantData, useCodex } from '../data';
import { personMarkdown } from '../data/meetingMarkdown';
import { claimsMentioning } from '../data/wiki';
import { commitmentsOf, meetingsOf, nameOf, openQuestions, peopleOf, pinsOf, questionKey, sameName } from '../data/meetings';
import { PinList } from './Pins';
import { useActions } from '../useActions';
import { Icon } from '../../ui/Icon';
import { copyText, openMeeting, openTask, setView, useEscapeBack } from '../view';
import { ago, plural, safeHref } from '../../ui/util';
import { openTasksOf, personInbox, unanswered } from '../data/review';
import type { ItemRow } from '../data/sync';
import { Avatars, MeetingRow } from './Meetings';
import { OpenQuestions, resolvedQuestions } from './OpenQuestions';
import { AddPoint, PointList, useMarkRaised } from './Raise';
import { firstName, pointsOf } from '../data/points';
import '../../styles/features/wiki.css';

const pill = (n: number) => (n > 5 ? <span className="mt-of">{n}</span> : null);

function Asks({ title, rows }: { title: string; rows: ItemRow[] }) {
  const act = useActions();
  if (!rows.length) return null;
  return (
    <section className="mt-sec">
      <h2>{title}{pill(rows.length)}</h2>
      <ul className="wk-claims">
        {rows.map((r) => (
          <li key={r.profile + r.id} className="wk-claim">
            <span className="wk-claim-text">{r.title}</span>
            <span className="wk-claim-foot">
              {r.source === 'gmail' ? 'Gmail' : 'Slack'}{r.status === 'suggested' ? ' · to review' : ''} · {ago(r.updated_at, ' ago')}
              {safeHref(r.source_url) && <> · <a className="mt-person" href={safeHref(r.source_url)} target="_blank" rel="noreferrer">Open</a></>}
              <button className="wk-act" title="Done" onClick={() => act.done(r)}><Icon name="check" small /> Done</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OpenTasks({ rows }: { rows: ItemRow[] }) {
  const act = useActions();
  if (!rows.length) return null;
  return (
    <section className="mt-sec">
      <h2>Open tasks{pill(rows.length)}</h2>
      <ul className="wk-claims">
        {rows.map((r) => (
          <li key={r.profile + r.id} className="wk-claim">
            <span className="wk-claim-text"><button className="mt-person" onClick={() => openTask(r)}>{r.title || '(Untitled)'}</button></span>
            <span className="wk-claim-foot"><button className="wk-act" title="Done" onClick={() => act.done(r)}><Icon name="check" small /> Done</button></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Person({ name }: { name: string }) {
  const { meetings, facts, pages } = useCodex();
  const snap = useAssistantData();
  const back = () => setView({ person: null });
  useEscapeBack(back);
  useMarkRaised();
  const mine = useMemo(() => meetingsOf(meetings, name), [meetings, name]);
  const shown = useMemo(() => nameOf(meetings, name), [meetings, name]);
  const email = name.includes('@') ? name.trim() : mine.flatMap(peopleOf).find((p) => p.includes('@') && sameName(p, name));
  const points = useMemo(() => pointsOf(snap.items, name), [snap.items, name]);
  const pins = useMemo(() => pinsOf(snap.items, mine), [snap.items, mine]);
  const commitments = useMemo(() => commitmentsOf(meetings, name), [meetings, name]);
  const claims = useMemo(() => claimsMentioning(facts, name), [facts, name]);
  const inbox = useMemo(() => personInbox(name, snap.items, snap.chats, unanswered(snap.briefs)), [name, snap.items, snap.chats, snap.briefs]);
  const waiting = useMemo(() => {
    const seen = new Set<string>();
    return [...inbox.asks, ...inbox.promises].filter((r) => {
      const k = r.profile + r.id;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [inbox]);
  const tasks = useMemo(() => openTasksOf(name, snap.items), [name, snap.items]);
  const questions = openQuestions(mine);
  const title = useMemo(() => new Map(pages.map((p) => [p.id, p.title])), [pages]);
  const now = Date.now();
  const copy = () => {
    const resolved = resolvedQuestions();
    const text = personMarkdown(name, { commitments, questions: questions.filter((q) => !resolved.includes(questionKey(q))), points, tasks, pins, meetings: mine, claims });
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
          <div className="mt-person-head"><Avatars people={[shown]} /><div><h1 className="wk-title">{shown}</h1>{email && <div className="muted small">{email}</div>}</div></div>
          <div className="wk-meta mt-when"><span>{plural(mine.length, 'meeting')}</span></div>

          {inbox.dm && (
            <section className="mt-sec">
              <h2>Slack DM</h2>
              <p className="sm-text" title={inbox.dm.summary ?? undefined}>{(inbox.dm.summary ?? '').split('\n')[0]}</p>
              <div className="wk-meta">
                {inbox.dm.last_at ? <span>{ago(inbox.dm.last_at, ' ago')}</span> : null}
                {safeHref(inbox.dm.url) && <a className="mt-person" href={safeHref(inbox.dm.url)} target="_blank" rel="noreferrer">Open in Slack</a>}
              </div>
            </section>
          )}
          <Asks title="Waiting on you" rows={waiting} />
          {inbox.mail.length > 0 && (
            <section className="mt-sec">
              <h2>Unanswered mail{pill(inbox.mail.length)}</h2>
              <ul className="wk-claims">
                {inbox.mail.map((w) => (
                  <li key={w.thread} className="wk-claim">
                    <span className="wk-claim-text">{w.subject}</span>
                    <span className="wk-claim-foot">sent {ago(w.sent_at, ' ago')}{safeHref(w.url) && <> · <a className="mt-person" href={safeHref(w.url)} target="_blank" rel="noreferrer">Open</a></>}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <OpenTasks rows={tasks} />

          {commitments.length > 0 && (
            <section className="mt-sec">
              <h2>Commitments{pill(commitments.length)}</h2>
              <ul className="wk-claims">
                {commitments.map((c, i) => (
                  <li key={i} className="wk-claim">
                    <span className="wk-claim-text">{c.what}</span>
                    <span className="wk-claim-foot"><button className="mt-person" onClick={() => openMeeting(c.meeting)}>{c.meeting.title}</button></span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-sec">
            <h2>Raise with {firstName(shown)}{pill(points.length)}</h2>
            {points.length > 0 && <PointList points={points} person={false} />}
            <AddPoint person={name} profile={mine[0]?.profile ?? 'work'} />
          </section>

          <OpenQuestions questions={questions} />

          {pins.length > 0 && (
            <section className="mt-sec">
              <h2>Pinned{pill(pins.length)}</h2>
              <PinList pins={pins} onOpen={(r) => openMeeting({ profile: r.profile, id: r.meeting_id! })} />
            </section>
          )}

          <section className="mt-sec">
            <h2>Meetings</h2>
            {mine.length > 0 ? <div className="mt-rows">{mine.map((m) => <MeetingRow key={m.profile + m.id} m={m} now={now} />)}</div> : <p className="mt-pending">No meetings.</p>}
          </section>

          {claims.length > 0 && (
            <section className="mt-sec">
              <h2>In the wiki{pill(claims.length)}</h2>
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
