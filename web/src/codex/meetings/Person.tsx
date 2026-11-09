import { useMemo, useState, type ReactNode } from 'react';
import { useAssistantData, useCodex } from '../data';
import { personMarkdown } from '../data/meetings/meetingMarkdown';
import { claimsMentioning } from '../data/wiki/wiki';
import { commitmentsOf, meetingsOf, nameOf, openQuestions, peopleOf, pinsOf, questionKey, sameName } from '../data/meetings/meetings';
import { PinList } from './Pins';
import { useActions } from '../useActions';
import { Icon } from '../../ui/Icon';
import { EmptyState } from '../../ui/Panel';
import { AskRow } from '../../ui/AskRow';
import { MenuItem } from '../../ui/Menu';
import { Row } from '../../ui/Row';
import { Section, sectionCount } from '../../ui/Section';
import { CardRow } from '../overview/CardRow';
import { dueText, taskMenu } from '../tasks/Task';
import { copyText, openMeeting, openTask, setView, useEscapeBack } from '../view';
import { ago, plural, safeHref } from '../../ui/util';
import { openTasksOf, personInbox, unanswered } from '../data/tasks/review';
import type { ItemRow } from '../data/sync';
import { Avatars, MeetingRow } from './MeetingList';
import { OpenQuestions, resolvedQuestions } from './OpenQuestions';
import { AddPoint, PointList, useMarkRaised } from './Raise';
import { firstName, pointsOf } from '../data/meetings/points';
import '../../styles/features/wiki.css';
import '../../styles/features/meetings.css';

const pill = (n: number) => (n > 0 ? <span className="mt-of">{n}</span> : null);

const FIRST = 5;
const firstRows = <T,>(rows: T[], all: boolean) => (all ? rows : rows.slice(0, FIRST));

// The rows of one list in an as-group: the first five, then Show all N. Folds again when another person opens.
function Group<T>({ rows, name, row }: { rows: T[]; name: string; row: (r: T) => ReactNode }) {
  const [shownFor, setShownFor] = useState<string | null>(null);
  const all = shownFor === name;
  return (
    <div className="as-group">
      {firstRows(rows, all).map(row)}
      {rows.length > FIRST && !all && <AskRow title={`Show all ${rows.length}`} onClick={() => setShownFor(name)} />}
    </div>
  );
}

function Asks({ name, rows }: { name: string; rows: ItemRow[] }) {
  const act = useActions();
  if (!rows.length) return null;
  return (
    <section className="mt-sec">
      <Section label="Waiting on you" count={rows.length} />
      <Group rows={rows} name={name} row={(r) => {
        const href = safeHref(r.source_url);
        const gmail = r.source === 'gmail';
        return (
          <CardRow
            key={r.profile + r.id}
            title={r.title || '(Untitled)'}
            meta={`${gmail ? 'Gmail' : 'Slack'} · ${ago(r.updated_at, ' ago')}`}
            badge={r.status === 'suggested' ? { status: 'waiting', label: 'Needs you' } : undefined}
            onOpen={() => openTask(r)}
            button={{ label: 'Done', run: () => act.done(r) }}
            menu={(choose) => (
              <>
                <MenuItem icon="arrow-right" onClick={choose(() => openTask(r))}>Open</MenuItem>
                {href && <MenuItem icon="link" href={href} onClick={choose(() => undefined)}>Open in {gmail ? 'Gmail' : 'Slack'}</MenuItem>}
              </>
            )}
          />
        );
      }} />
    </section>
  );
}

function OpenTasks({ name, rows }: { name: string; rows: ItemRow[] }) {
  const act = useActions();
  if (!rows.length) return null;
  const now = Date.now();
  return (
    <section className="mt-sec">
      <Section label="Open tasks" count={rows.length} />
      <Group rows={rows} name={name} row={(r) => (
        <CardRow
          key={r.profile + r.id}
          title={r.title || '(Untitled)'}
          meta={dueText(r, now)}
          onOpen={() => openTask(r)}
          action={{ icon: 'check', label: 'Done', run: () => act.done(r) }}
          menu={(choose) => taskMenu(r, act, choose, () => openTask(r))}
        />
      )} />
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
          <Section label={shown} />
          <Row plain leading={<Avatars people={[shown]} />} title={email || plural(mine.length, 'meeting')} meta={email ? plural(mine.length, 'meeting') : undefined} />

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
          <Asks name={name} rows={waiting} />
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

          <OpenTasks name={name} rows={tasks} />

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
            <Section label="Meetings" count={sectionCount(mine.length)} />
            {mine.length > 0 ? <Group rows={mine} name={name} row={(m) => <MeetingRow key={m.profile + m.id} m={m} now={now} />} /> : <EmptyState size="sm" title="No meetings" />}
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
