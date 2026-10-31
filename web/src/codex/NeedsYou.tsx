import { useMemo, useRef, useState } from 'react';
import { useAssistantStore, useAssistantData } from './data';
import { live, type Chat } from './data/wiki';
import { atTime, errorText, nextNine } from './data/engine';
import type { ItemRow } from './data/sync';
import { atRisk, minutesText, type Span } from './data/plan';
import { CAP, collapse, rankNeeds } from './data/needsYou';
import { needsYou } from './summary/Summary';
import { ActionRow } from './meetings/Meetings';
import { UNROLL, unrollFor, useActions } from './useActions';
import { ago, safeHref, save, stored } from '../ui/util';
import { blockId, isBlock } from '../../../shared/util';
import { Icon } from '../ui/Icon';
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
      s.review.map((row) => ({ kind: 'ask', row, keys: [taskKey(row)], marks: urlKey(row.source_url) })),
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
  const store = useAssistantStore();
  const act = useActions();
  const [showAll, setShowAll] = useState(false);
  if (!n.rows.length) return null;
  const snooze = (r: ItemRow) => {
    haptic('tap');
    const at = nextNine(new Date(Math.max(atTime(r.at) ?? 0, now)), r.profile);
    void store.update(r, { at, ...unrollFor(at) }).then(() => showSnack(`Snoozed to ${when(at)}`));
  };
  const moveToday = (rows: ItemRow[]) => {
    haptic('success');
    const before = rows.map((r) => ({ r, at: r.at, rolls: r.rolls, rolled_from: r.rolled_from }));
    for (const r of rows) {
      const from = new Date(atTime(r.at) ?? now);
      const t = new Date(now).setHours(from.getHours(), from.getMinutes(), 0, 0);
      const at = t > now ? t : now;
      void store.update(r, { at, ...UNROLL });
    }
    showSnack('Moved to today', () => before.forEach(({ r, ...prev }) => void store.update(r, prev)));
  };
  const taskRow = (r: ItemRow, label: string, note: string) => (
    <div key={r.profile + r.id} className="ov-follow-row">
      <button className="ov-follow-text" onClick={() => openTask(r)}>
        <span className="ov-t">{r.title}</span>
        <span className="muted small">{label}{note}</span>
      </button>
      <button className="ov-check" aria-label={`Mark ${r.title} done`} onClick={() => { haptic('success'); act.done(r); }}><Icon name="circle-large-outline" small /></button>
      <button className="ov-check" aria-label={`Snooze ${r.title} to tomorrow`} title="Tomorrow 09:00" onClick={() => snooze(r)}><Icon name="clock" small /></button>
    </div>
  );
  const rowOf = (x: Need) => {
    switch (x.kind) {
      case 'overdue': return taskRow(x.row, 'Overdue', atTime(x.row.at) != null ? ` · due ${when(atTime(x.row.at)!, now)}` : '');
      case 'overdueAll': return (
        <div key="overdue" className="ov-follow-row">
          <button className="ov-follow-text" onClick={() => setView({ list: 'tasks', open: null })}>
            <span className="ov-t">{x.rows.length} overdue</span>
            <span className="muted small">Open Tasks to go through them</span>
          </button>
          <button className="ov-check" aria-label={`Move ${x.rows.length} overdue tasks to today`} title="Move all to today" onClick={() => moveToday(x.rows)}><Icon name="arrow-right" small /></button>
        </div>
      );
      case 'risk': return taskRow(x.row, 'At risk', ` · due ${when(x.due, now)} · ${minutesText(x.short)} short`);
      case 'ask': return <ActionRow key={x.row.profile + x.row.id} row={x.row} />;
      case 'dm': {
        const c = x.chat;
        return (
          <div key={c.profile + c.id} className="ov-follow-row wrap">
            <button className="ov-follow-text" onClick={() => setView({ person: c.name })}>
              <span className="ov-t">{c.name}</span>
              <span className="muted small">DM · {c.last_at ? `${ago(c.last_at, ' ago')} · ` : ''}{c.summary}</span>
            </button>
            {safeHref(c.url) && <a className="btn sm" href={safeHref(c.url)} target="_blank" rel="noreferrer" aria-label={`Open the DM with ${c.name} in Slack`}>Open in Slack</a>}
            <button className="btn sm" aria-label={`Make a task to reply to ${c.name}`} onClick={() => n.chatTask(c)}>Task</button>
            <button className="btn sm" aria-label={`Dismiss ${c.name}`} onClick={() => n.hideChat(c)}>Dismiss</button>
          </div>
        );
      }
      case 'slack':
        return (
          <div key={x.keys[0]} className="ov-follow-row">
            <a className="ov-follow-text" href={x.x.url ?? undefined} target="_blank" rel="noreferrer">
              <span className="ov-t">{x.x.title}</span>
              <span className="muted small">Slack{x.x.why ? ` · ${x.x.why}` : ''}</span>
            </a>
            <button className="btn sm" aria-label={`Make ${x.x.title} a task`} onClick={() => n.bulletTask(x.x, x.profile)}>Task</button>
            <button className="btn sm" aria-label={`Mark ${x.x.title} handled`} onClick={() => n.hideBullet(x.x)}>Done</button>
          </div>
        );
    }
  };
  return (
    <section>
      <div className="as-section late">Needs you · {n.rows.length}</div>
      <div className="ov-follow ov-needs">
        {(showAll ? n.rows : n.rows.slice(0, CAP)).map(rowOf)}
        {!showAll && n.rows.length > CAP && (
          <div className="ov-follow-row">
            <span className="ov-follow-text" />
            <button className="btn sm" onClick={() => setShowAll(true)}>Show {n.rows.length - CAP} more</button>
          </div>
        )}
      </div>
    </section>
  );
}
