import { useMemo, useRef, useState } from 'react';
import { useAssistantStore, useAssistantData } from './data';
import { live, type Chat } from './data/wiki';
import { atTime, errorText } from './data/engine';
import type { ItemRow } from './data/sync';
import { atRisk, minutesText, type Span } from './data/plan';
import { CAP, collapse, rankNeeds } from './data/needsYou';
import { needsYou } from './summary/needsYou';
import { ActionRow } from './meetings/ActionRow';
import { useActions } from './useActions';
import { ago, safeHref, save, stored } from '../ui/util';
import { blockId, isBlock } from '../../../shared/util';
import { Button } from '../ui/Button';
import { MenuItem } from '../ui/Menu';
import { Section } from '../ui/Section';
import { CardRow } from './overview/CardRow';
import { haptic } from '../ui/haptic';
import { openTask, setView, showSnack, useView } from './view';
import { when } from './time';
import type { useSplit } from './split';

const WAIT_HANDLED = 'codex.waitingHandled';
const SLACK_HANDLED = 'codex.slackHandled';
const waitKey = (c: Chat) => `${c.profile}:${c.id}:${c.last_at ?? ''}`;
const urlKey = (u: string | null | undefined) => (safeHref(u) ? [`url:${safeHref(u)}`] : []);

type Bullet = { title: string; url: string | null; why: string };
type Need =
  | { kind: 'overdue'; row: ItemRow; keys: string[] }
  | { kind: 'overdueAll'; rows: ItemRow[]; keys: string[] }
  | { kind: 'risk'; row: ItemRow; due: number; short: number; keys: string[] }
  | { kind: 'ask'; row: ItemRow; keys: string[]; marks: string[] }
  | { kind: 'dm'; chat: Chat; keys: string[] }
  | { kind: 'slack'; x: Bullet; profile: Chat['profile']; keys: string[] };

const taskKey = (r: ItemRow) => `task:${r.profile}:${r.id}`;
const bulletKey = (x: Bullet) => x.url ?? x.title;

// Overdue and at-risk tasks, asks and promises to confirm, DMs waiting on me and the Slack brief's "Needs you" bullets, once each.
export function useNeedsYou(s: ReturnType<typeof useSplit>, now: number) {
  const store = useAssistantStore();
  const snap = useAssistantData();
  const { filter } = useView();
  const [waitDone, setWaitDone] = useState<string[]>(() => stored<string[]>(WAIT_HANDLED, []));
  const [slackDone, setSlackDone] = useState<string[]>(() => stored<string[]>(SLACK_HANDLED, []));
  const pending = useRef(new Set<string>());
  const minute = Math.floor(now / 60000);
  const rows = useMemo(() => {
    const timed = live(snap.meetings).filter((m) => (filter === 'all' || m.profile === filter) && m.starts_at != null && m.ends_at != null && m.ends_at > m.starts_at && m.ends_at - m.starts_at < 20 * 3600_000);
    const blocked = new Set(timed.filter((m) => isBlock(m.id) && m.ends_at! > minute * 60000).map((m) => `${m.profile}:${m.id}`));
    const tasks = [...s.overdue, ...s.today, ...s.later].flatMap((r) => {
      const due = atTime(r.at);
      return due != null && !blocked.has(`${r.profile}:${blockId(r.id)}`) ? [{ title: r.title, due, r }] : [];
    });
    const risk = atRisk(tasks, timed.map((m) => [m.starts_at!, m.ends_at!] as Span), minute * 60000);
    const dms = live(snap.chats).filter((c) => c.kind === 'dm' && c.waiting === 1 && (filter === 'all' || c.profile === filter) && !waitDone.includes(waitKey(c))).sort((a, b) => (b.last_at ?? 0) - (a.last_at ?? 0));
    const brief = snap.briefs.filter((b) => !b.deleted && b.kind === 'slack' && (filter === 'all' || b.profile === filter)).sort((a, b) => (b.to_at ?? 0) - (a.to_at ?? 0))[0];
    const bullets = brief?.text ? needsYou(brief.text).filter((x) => !slackDone.includes(bulletKey(x))) : [];
    const ranked = rankNeeds<Need>([
      s.overdue.map((row) => ({ kind: 'overdue', row, keys: [taskKey(row)] })),
      risk.map(({ task, short }) => ({ kind: 'risk', row: task.r, due: task.due, short, keys: [taskKey(task.r)] })),
      s.review.filter((row) => !(row.source === 'slack' && row.draft?.trim())).map((row) => ({ kind: 'ask', row, keys: [taskKey(row)], marks: urlKey(row.source_url) })),
      dms.map((chat) => ({ kind: 'dm', chat, keys: [`chat:${chat.profile}:${chat.id}`, ...urlKey(chat.url)] })),
      bullets.map((x) => ({ kind: 'slack', x, profile: brief!.profile, keys: urlKey(x.url).length ? urlKey(x.url) : [`slack:${x.title}`] })),
    ]);
    return collapse<Need>(ranked, (x) => x.kind === 'overdue', 3, (xs) => ({ kind: 'overdueAll', rows: xs.flatMap((x) => (x.kind === 'overdue' ? [x.row] : [])), keys: [] }));
  }, [snap.meetings, snap.chats, snap.briefs, filter, s, minute, waitDone, slackDone]);
  const hideChat = (c: Chat) => {
    const next = [...stored<string[]>(WAIT_HANDLED, []).filter((k) => live(snap.chats).some((r) => waitKey(r) === k)), waitKey(c)];
    setWaitDone(next);
    save(WAIT_HANDLED, next);
  };
  const hideBullet = (x: Bullet) => {
    setSlackDone((h) => {
      const next = [...h, bulletKey(x)].slice(-50);
      save(SLACK_HANDLED, next);
      return next;
    });
  };
  const capture = (key: string, title: string, profile: Chat['profile'], fill: (r: ItemRow) => Promise<unknown> | undefined, done: () => void) => {
    if (pending.current.has(key)) return;
    pending.current.add(key);
    haptic('tap');
    void store.capture(title, 'task', profile)
      .then(fill)
      .then(() => { done(); showSnack('Added to Tasks'); }, (err) => {
        pending.current.delete(key);
        showSnack(`Could not add: ${errorText(err)}`);
      });
  };
  const chatTask = (c: Chat) => {
    const name = c.name ?? 'DM';
    capture(waitKey(c), `Reply to ${name}`, c.profile, (r) => store.update(r, { text: [c.summary, safeHref(c.url)].filter(Boolean).join('\n\n') || null, source: 'slack', people: `${name} · DM` }), () => hideChat(c));
  };
  const bulletTask = (x: Bullet, profile: Chat['profile']) => {
    capture(bulletKey(x), x.why ? `${x.title}: ${x.why}` : x.title, profile, (r) => (x.url ? store.update(r, { text: x.url }) : undefined), () => hideBullet(x));
  };
  return { rows, hideChat, hideBullet, chatTask, bulletTask };
}

export function NeedsYou({ n, now }: { n: ReturnType<typeof useNeedsYou>; now: number }) {
  const act = useActions();
  const [showAll, setShowAll] = useState(false);
  if (!n.rows.length) return null;
  const snooze = (r: ItemRow) => { haptic('tap'); act.snoozeLater(r, now); };
  const moveToday = (rows: ItemRow[]) => { haptic('success'); act.moveToToday(rows, now); };
  const taskRow = (r: ItemRow, badge: { label: string; tone: 'waiting' | 'quiet' }, note: string) => (
    <CardRow key={r.profile + r.id} title={r.title} meta={note} badge={badge} onOpen={() => openTask(r)}
      action={{ icon: 'check', label: 'Done', run: () => { haptic('success'); act.done(r); } }}
      menu={(choose) => <MenuItem icon="clock" onClick={choose(() => snooze(r))}>Snooze to next 09:00</MenuItem>} />
  );
  const needs = { label: 'Needs you', tone: 'waiting' } as const;
  const slackLink = (url: string | null | undefined, choose: (fn: () => void) => () => void) => safeHref(url) && <MenuItem icon="link" href={safeHref(url)!} onClick={choose(() => undefined)}>Open in Slack</MenuItem>;
  const rowOf = (x: Need) => {
    switch (x.kind) {
      case 'overdue': return taskRow(x.row, { label: 'Overdue', tone: 'waiting' }, atTime(x.row.at) != null ? `due ${when(atTime(x.row.at)!, now)}` : '');
      case 'overdueAll': return <CardRow key="overdue" title={`${x.rows.length} overdue`} meta="Open Tasks to go through them" badge={{ label: 'Overdue', tone: 'waiting' }} onOpen={() => setView({ list: 'tasks', open: null })} />;
      case 'risk': return taskRow(x.row, { label: 'At risk', tone: 'quiet' }, `due ${when(x.due, now)} · ${minutesText(x.short)} short`);
      case 'ask': return <ActionRow key={x.row.profile + x.row.id} row={x.row} />;
      case 'dm': {
        const c = x.chat;
        return (
          <CardRow key={c.profile + c.id} title={c.name} meta={`DM · ${c.last_at ? `${ago(c.last_at, ' ago')} · ` : ''}${c.summary ?? ''}`} badge={needs} onOpen={() => setView({ person: c.name })}
            action={{ icon: 'close', label: `Dismiss ${c.name}`, run: () => n.hideChat(c) }}
            menu={(choose) => (
              <>
                <MenuItem icon="add" onClick={choose(() => n.chatTask(c))}>Make a task</MenuItem>
                {slackLink(c.url, choose)}
              </>
            )} />
        );
      }
      case 'slack':
        return (
          <CardRow key={x.keys[0]} title={x.x.title} meta={`Slack${x.x.why ? ` · ${x.x.why}` : ''}`} badge={needs} onOpen={() => setView({ list: 'summary', open: null })}
            action={{ icon: 'close', label: `Dismiss ${x.x.title}`, run: () => n.hideBullet(x.x) }}
            menu={(choose) => (
              <>
                <MenuItem icon="add" onClick={choose(() => n.bulletTask(x.x, x.profile))}>Make a task</MenuItem>
                {slackLink(x.x.url, choose)}
              </>
            )} />
        );
    }
  };
  const collapsed = n.rows.find((x) => x.kind === 'overdueAll');
  return (
    <section>
      <Section label="Needs you" count={n.rows.length}
        action={collapsed?.kind === 'overdueAll' && <Button variant="quiet" size="sm" onClick={() => moveToday(collapsed.rows)}>Move {collapsed.rows.length} overdue to today</Button>} />
      <div className="as-group ov-queue-group">
        {(showAll ? n.rows : n.rows.slice(0, CAP)).map(rowOf)}
        {!showAll && n.rows.length > CAP && (
          <div className="ov-ask"><div className="ov-ask-line"><Button variant="quiet" size="sm" onClick={() => setShowAll(true)}>Show {n.rows.length - CAP} more</Button></div></div>
        )}
      </div>
    </section>
  );
}
