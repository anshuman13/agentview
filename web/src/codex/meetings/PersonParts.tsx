import { useState, type ReactNode } from 'react';
import { useActions } from '../useActions';
import { AskRow } from '../../ui/AskRow';
import { MenuItem } from '../../ui/Menu';
import { Row } from '../../ui/Row';
import { Section, sectionCount } from '../../ui/Section';
import { CardRow } from '../overview/CardRow';
import { dueText, taskMenu } from '../tasks/Task';
import { openMeeting, openTask, setView } from '../view';
import { ago, safeHref } from '../../ui/util';
import type { ItemRow } from '../data/sync';
import type { commitmentsOf } from '../data/meetings/meetings';
import type { Fact } from '../data/wiki/wiki';
import type { personInbox } from '../data/tasks/review';
import { UNTITLED } from '../../../../shared/util';

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
            title={r.title || UNTITLED}
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
          title={r.title || UNTITLED}
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
  const href = safeHref(dm.url);
  return (
    <section className="mt-sec">
      <Section label="Slack DM" />
      <div className="as-group">
        <Row title={(dm.summary ?? '').split('\n')[0] || 'Slack DM'} meta={dm.last_at ? ago(dm.last_at, ' ago') : undefined} href={href} plain={!href} />
      </div>
    </section>
  );
}

export function UnansweredMail({ name, mail }: { name: string; mail: Inbox['mail'] }) {
  if (!mail.length) return null;
  return (
    <section className="mt-sec">
      <Section label="Unanswered mail" count={sectionCount(mail.length)} />
      <Group rows={mail} name={name} row={(w) => {
        const href = safeHref(w.url);
        return <Row key={w.thread} title={w.subject} meta={`sent ${ago(w.sent_at, ' ago')}`} href={href} plain={!href} />;
      }} />
    </section>
  );
}

export function Commitments({ name, commitments }: { name: string; commitments: ReturnType<typeof commitmentsOf> }) {
  if (!commitments.length) return null;
  return (
    <section className="mt-sec">
      <Section label="Commitments" count={sectionCount(commitments.length)} />
      <Group rows={commitments} name={name} row={(c) => (
        <Row key={c.meeting.profile + c.meeting.id + c.what} title={c.what} meta={c.meeting.title} onClick={() => openMeeting(c.meeting)} />
      )} />
    </section>
  );
}

export function WikiClaims({ name, claims, pageTitle }: { name: string; claims: Fact[]; pageTitle: Map<string, string | null> }) {
  if (!claims.length) return null;
  return (
    <section className="mt-sec">
      <Section label="In the wiki" count={sectionCount(claims.length)} />
      <Group rows={claims} name={name} row={(f) => (
        <Row key={f.id} title={f.text} meta={f.page_id ? pageTitle.get(f.page_id) : undefined} plain={!f.page_id} onClick={f.page_id ? () => setView({ person: null, list: 'wiki', open: f.page_id, anchor: null }) : undefined} />
      )} />
    </section>
  );
}
