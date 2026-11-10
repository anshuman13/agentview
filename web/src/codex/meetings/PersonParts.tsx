import { useState, type ReactNode } from 'react';
import { useActions } from '../useActions';
import { AskRow } from '../../ui/AskRow';
import { MenuItem } from '../../ui/Menu';
import { Section } from '../../ui/Section';
import { CardRow } from '../overview/CardRow';
import { dueText, taskMenu } from '../tasks/Task';
import { openMeeting, openTask, setView } from '../view';
import { ago, safeHref } from '../../ui/util';
import type { ItemRow } from '../data/sync';
import type { commitmentsOf } from '../data/meetings/meetings';
import type { Fact } from '../data/wiki/wiki';
import type { personInbox } from '../data/tasks/review';

export const pill = (n: number) => (n > 0 ? <span className="mt-of">{n}</span> : null);

const FIRST = 5;
const firstRows = <T,>(rows: T[], all: boolean) => (all ? rows : rows.slice(0, FIRST));

// The rows of one list in an as-group: the first five, then Show all N. Folds again when another person opens.
export function Group<T>({ rows, name, row }: { rows: T[]; name: string; row: (r: T) => ReactNode }) {
  const [shownFor, setShownFor] = useState<string | null>(null);
  const all = shownFor === name;
  return (
    <div className="as-group">
      {firstRows(rows, all).map(row)}
      {rows.length > FIRST && !all && <AskRow title={`Show all ${rows.length}`} onClick={() => setShownFor(name)} />}
    </div>
  );
}

export function Asks({ name, rows }: { name: string; rows: ItemRow[] }) {
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
            badge={r.status === 'suggested' ? { status: 'waiting', label: 'Needs you' } : null}
            onOpen={() => openTask(r)}
            button={{ label: 'Done', run: () => act.done(r) }}
            menu={(
              <>
                <MenuItem icon="arrow-right" onClick={() => openTask(r)}>Open</MenuItem>
                {href && <MenuItem icon="link" href={href}>Open in {gmail ? 'Gmail' : 'Slack'}</MenuItem>}
              </>
            )}
          />
        );
      }} />
    </section>
  );
}

export function OpenTasks({ name, rows }: { name: string; rows: ItemRow[] }) {
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
          menu={taskMenu(r, act, () => openTask(r))}
        />
      )} />
    </section>
  );
}

type Inbox = ReturnType<typeof personInbox>;

export function SlackDm({ dm }: { dm: NonNullable<Inbox['dm']> }) {
  return (
    <section className="mt-sec">
      <h2>Slack DM</h2>
      <p className="sm-text" title={dm.summary ?? undefined}>{(dm.summary ?? '').split('\n')[0]}</p>
      <div className="wk-meta">
        {dm.last_at ? <span>{ago(dm.last_at, ' ago')}</span> : null}
        {safeHref(dm.url) && <a className="mt-person" href={safeHref(dm.url)} target="_blank" rel="noreferrer">Open in Slack</a>}
      </div>
    </section>
  );
}

export function UnansweredMail({ mail }: { mail: Inbox['mail'] }) {
  if (!mail.length) return null;
  return (
    <section className="mt-sec">
      <h2>Unanswered mail{pill(mail.length)}</h2>
      <ul className="wk-claims">
        {mail.map((w) => (
          <li key={w.thread} className="wk-claim">
            <span className="wk-claim-text">{w.subject}</span>
            <span className="wk-claim-foot">sent {ago(w.sent_at, ' ago')}{safeHref(w.url) && <> · <a className="mt-person" href={safeHref(w.url)} target="_blank" rel="noreferrer">Open</a></>}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Commitments({ commitments }: { commitments: ReturnType<typeof commitmentsOf> }) {
  if (!commitments.length) return null;
  return (
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
  );
}

export function WikiClaims({ claims, pageTitle }: { claims: Fact[]; pageTitle: Map<string, string | null> }) {
  if (!claims.length) return null;
  return (
    <section className="mt-sec">
      <h2>In the wiki{pill(claims.length)}</h2>
      <ul className="wk-claims">
        {claims.map((f) => (
          <li key={f.id} className="wk-claim">
            <span className="wk-claim-text">{f.text}</span>
            {f.page_id && <span className="wk-claim-foot"><button className="mt-person" onClick={() => setView({ person: null, list: 'wiki', open: f.page_id, anchor: null })}>{pageTitle.get(f.page_id)}</button></span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
