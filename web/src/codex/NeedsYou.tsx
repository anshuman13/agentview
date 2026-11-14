import { useMemo, useRef, useState } from 'react';
import { useAssistantStore, useAssistantData, useCodex } from './data';
import { live, proposals, type Brief, type Chat, type Meeting } from './data/wiki/wiki';
import { atTime, errorText, reviewedSince } from './data/tasks/engine';
import { actionsOf } from './data/meetings/meetings';
import { followUpText } from './data/meetings/meetingMarkdown';
import type { ItemRow } from './data/sync';
import { atRisk, minutesText, type Span } from './data/tasks/plan';
import { CAP, collapse, groupNeeds, rankNeeds } from './data/tasks/needsYou';
import { needsYou } from './summary/needsYou';
import { ActionRow } from './meetings/ActionRow';
import { Swipe } from './gestures/Swipe';
import { useActions } from './useActions';
import { ago, plural, safeHref } from '../ui/util';
import { blockId, isBlock } from '../../../shared/util';
import { AskRow } from '../ui/AskRow';
import { Button } from '../ui/Button';
import { MenuItem } from '../ui/Menu';
import { Section, sectionCount } from '../ui/Section';
import { CardRow } from './overview/CardRow';
import { queued, replyQueue, staleAsks, STALE_DAYS } from './overview/ReplyQueue';
import { haptic } from '../ui/haptic';
import { copyText, openMeeting, openTask, setView, showSnack, useView } from './view';
import { when } from './tasks/time';
import type { useSplit } from './tasks/split';
import { dismissedKeys, withDismissal } from '../../../shared/dismissed';

const waitKey = (c: Chat) => `${c.profile}:${c.id}:${c.last_at ?? ''}`;
const urlKey = (u: string | null | undefined) => (safeHref(u) ? [`url:${safeHref(u)}`] : []);

type Bullet = { title: string; url: string | null; why: string };
type Need =
  | { kind: 'overdue'; row: ItemRow; keys: string[] }
  | { kind: 'overdueAll'; rows: ItemRow[]; keys: string[] }
  | { kind: 'risk'; row: ItemRow; due: number; short: number; keys: string[] }
  | { kind: 'ask'; row: ItemRow; keys: string[]; marks: string[] }
  | { kind: 'dm'; chat: Chat; keys: string[] }
  | { kind: 'slack'; x: Bullet; brief: Brief; keys: string[] }
  | { kind: 'justEnded'; row: ItemRow; meeting: Meeting; actions: ItemRow[]; keys: string[] }
  | { kind: 'staleAsks'; count: number; oldest: number; keys: string[] }
  | { kind: 'wiki'; count: number; keys: string[] };

const NOTED = 'Saved as a note';
const NOTE_FAILED = 'Could not save the note. The item is still here.';
const JUST_ENDED_MS = 2 * 3600_000;

const taskKey = (r: ItemRow) => `task:${r.profile}:${r.id}`;
const bulletKey = (x: Bullet) => x.url ?? x.title;
// Dismissed bullets are stored on the brief row, so every device hides them.
const dismissedOf = (b: Brief) => dismissedKeys(b.dismissed);

// Overdue and at-risk tasks, asks and promises to confirm, DMs waiting on me and the Slack brief's "Needs you" bullets, once each.
export function useNeedsYou(s: ReturnType<typeof useSplit>, now: number) {
  const store = useAssistantStore();
  const snap = useAssistantData();
  const { facts } = useCodex();
  const { filter } = useView();
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
    const dms = live(snap.chats).filter((c) => c.kind === 'dm' && c.waiting === 1 && (filter === 'all' || c.profile === filter)).sort((a, b) => (b.last_at ?? 0) - (a.last_at ?? 0));
    // A Slack summary older than the stale-ask age is out of date; its bullets are not shown.
    const brief = snap.briefs.filter((b) => !b.deleted && b.kind === 'slack' && (filter === 'all' || b.profile === filter) && minute * 60000 - (b.to_at ?? 0) <= STALE_DAYS * 86400_000).sort((a, b) => (b.to_at ?? 0) - (a.to_at ?? 0))[0];
    const bullets = brief?.text ? needsYou(brief.text).filter((x) => !dismissedOf(brief).includes(bulletKey(x))) : [];
    const ended = s.meetingsToday.filter((m) => m.ends_at != null && m.ends_at <= minute * 60000 && minute * 60000 - m.ends_at < JUST_ENDED_MS);
    const old = staleAsks(replyQueue(s.review, minute * 60000), minute * 60000);
    const claims = proposals(facts).length;
    const ranked = rankNeeds<Need>([
      s.overdue.map((row) => ({ kind: 'overdue', row, keys: [taskKey(row)] })),
      risk.map(({ task, short }) => ({ kind: 'risk', row: task.r, due: task.due, short, keys: [taskKey(task.r)] })),
      s.review.filter((row) => !queued(row)).map((row) => ({ kind: 'ask', row, keys: [taskKey(row)], marks: urlKey(row.source_url) })),
      dms.map((chat) => ({ kind: 'dm', chat, keys: [`chat:${chat.profile}:${chat.id}`, ...urlKey(chat.url)] })),
      bullets.map((x) => ({ kind: 'slack', x, brief: brief!, keys: urlKey(x.url).length ? urlKey(x.url) : [`slack:${x.title}`] })),
      ended.flatMap((meeting) => {
        const actions = actionsOf(snap.items, meeting).filter((r) => r.status === 'open');
        return actions.map((row) => ({ kind: 'justEnded', row, meeting, actions, keys: [taskKey(row)] }));
      }),
      old.length ? [{ kind: 'staleAsks', count: old.length, oldest: Math.min(...old.map(reviewedSince)), keys: ['stale-asks'] }] : [],
      claims ? [{ kind: 'wiki', count: claims, keys: ['wiki-claims'] }] : [],
    ]);
    return collapse<Need>(ranked, (x) => x.kind === 'overdue', 3, (xs) => ({ kind: 'overdueAll', rows: xs.flatMap((x) => (x.kind === 'overdue' ? [x.row] : [])), keys: [] }));
  }, [snap.meetings, snap.chats, snap.briefs, snap.items, facts, filter, s, minute]);
  // A dismissed DM stops waiting on the hub, so every device hides it until a new message.
  const hideChat = (c: Chat) => void store.editRow('chats', c, { waiting: 0 });
  const unhideChat = (c: Chat) => void store.editRow('chats', c, { waiting: 1 });
  const current = (b: Brief) => store.snapshot().briefs.find((r) => r.profile === b.profile && r.id === b.id) ?? b;
  const hideBullet = (b: Brief, x: Bullet) => void store.editRow('briefs', b, { dismissed: withDismissal(current(b).dismissed, bulletKey(x), true, Date.now()) });
  const unhideBullet = (b: Brief, x: Bullet) => void store.editRow('briefs', b, { dismissed: withDismissal(current(b).dismissed, bulletKey(x), false, Date.now()) });
  const dismissChat = (c: Chat) => { hideChat(c); showSnack('Dismissed', () => unhideChat(c)); };
  const dismissBullet = (b: Brief, x: Bullet) => { hideBullet(b, x); showSnack('Dismissed', () => unhideBullet(b, x)); };
  const capture = (key: string, title: string, profile: Chat['profile'], type: 'task' | 'note', fill: (r: ItemRow) => Promise<unknown> | undefined, done: (r: ItemRow) => void) => {
    if (pending.current.has(key)) return;
    pending.current.add(key);
    haptic('tap');
    void store.capture(title, type, profile)
      .then(async (r) => { await fill(r); return r; })
      .then(done, (err) => {
        pending.current.delete(key);
        showSnack(type === 'note' ? NOTE_FAILED : `Could not add: ${errorText(err)}`);
      });
  };
  const added = (hide: () => void) => () => { hide(); showSnack('Added to Tasks'); };
  const noted = (key: string, hide: () => void, unhide: () => void) => (r: ItemRow) => {
    hide();
    showSnack(NOTED, () => { pending.current.delete(key); unhide(); void store.update(r, { deleted: 1 }); });
  };
  const chatTask = (c: Chat) => {
    const name = c.name ?? 'DM';
    capture(waitKey(c), `Reply to ${name}`, c.profile, 'task', (r) => store.update(r, { text: [c.summary, safeHref(c.url)].filter(Boolean).join('\n\n') || null, source: 'slack', people: `${name} · DM` }), added(() => hideChat(c)));
  };
  const bulletTask = (b: Brief, x: Bullet) => {
    capture(bulletKey(x), x.why ? `${x.title}: ${x.why}` : x.title, b.profile, 'task', (r) => (x.url ? store.update(r, { text: x.url }) : undefined), added(() => hideBullet(b, x)));
  };
  const chatNote = (c: Chat) => {
    capture(waitKey(c), [c.name ?? 'DM', c.summary].filter(Boolean).join(': '), c.profile, 'note', (r) => (safeHref(c.url) ? store.update(r, { text: safeHref(c.url) }) : undefined), noted(waitKey(c), () => hideChat(c), () => unhideChat(c)));
  };
  const bulletNote = (b: Brief, x: Bullet) => {
    capture(bulletKey(x), x.why ? `${x.title}: ${x.why}` : x.title, b.profile, 'note', (r) => (x.url ? store.update(r, { text: x.url }) : undefined), noted(bulletKey(x), () => hideBullet(b, x), () => unhideBullet(b, x)));
  };
  const askNote = (row: ItemRow) => {
    const key = taskKey(row);
    if (pending.current.has(key)) return;
    pending.current.add(key);
    haptic('tap');
    store.update(row, { status: 'note' }).then(
      () => showSnack(NOTED, () => { pending.current.delete(key); void store.update(row, { status: 'suggested' }); }),
      () => { pending.current.delete(key); showSnack(NOTE_FAILED); },
    );
  };
  return { rows, dismissChat, dismissBullet, chatTask, bulletTask, chatNote, bulletNote, askNote };
}

export function NeedsYou({ n, now, onShowOld }: { n: ReturnType<typeof useNeedsYou>; now: number; onShowOld: () => void }) {
  const act = useActions();
  const [expanded, setExpanded] = useState<string[]>([]);
  if (!n.rows.length) return null;
  const snooze = (r: ItemRow) => { haptic('tap'); act.snoozeLater(r, now); };
  const moveToday = (rows: ItemRow[]) => { haptic('success'); act.moveToToday(rows, now); };
  const taskRow = (r: ItemRow, note: string) => (
    <CardRow key={r.profile + r.id} title={r.title} meta={note} onOpen={() => openTask(r)}
      action={{ icon: 'check', label: 'Done', run: () => { haptic('success'); act.done(r); } }}
      menu={<MenuItem icon="clock" onClick={() => snooze(r)}>Snooze to next 09:00</MenuItem>} />
  );
  const openReview = () => setView({ list: 'wiki', open: 'review', anchor: null, person: null });
  const slackLink = (url: string | null | undefined) => safeHref(url) && <MenuItem icon="link" href={safeHref(url)!}>Open in Slack</MenuItem>;
  const rowOf = (x: Need) => {
    switch (x.kind) {
      case 'overdue': return taskRow(x.row, atTime(x.row.at) != null ? `Overdue · due ${when(atTime(x.row.at)!, now)}` : 'Overdue');
      case 'overdueAll': return <CardRow key="overdue" title={`${x.rows.length} overdue`} meta="Open Tasks to go through them" onOpen={() => setView({ list: 'tasks', open: null })} />;
      case 'risk': return taskRow(x.row, `At risk · due ${when(x.due, now)} · ${minutesText(x.short)} short`);
      case 'ask': return <ActionRow key={x.row.profile + x.row.id} row={x.row} noBadge extraItems={(close) => <MenuItem icon="note" onClick={close(() => n.askNote(x.row))}>Nothing asked</MenuItem>} />;
      case 'justEnded': {
        const m = x.meeting;
        return (
          <ActionRow key={x.row.profile + x.row.id} row={x.row} noBadge meta={`Just ended · ${m.title}`} extraItems={(close) => (
            <>
              <MenuItem icon="mail" onClick={close(() => copyText(followUpText(m, x.actions), 'Follow-up copied'))}>Copy follow-up</MenuItem>
              <MenuItem icon="edit" onClick={close(() => openMeeting(m))}>Notes</MenuItem>
            </>
          )} />
        );
      }
      case 'staleAsks': return <CardRow key="stale-asks" title={`${plural(x.count, 'ask')} older than ${STALE_DAYS} days`} meta={`oldest ${ago(x.oldest)}`} onOpen={onShowOld} />;
      case 'wiki': return <CardRow key="wiki-claims" title={`${x.count} wiki ${x.count === 1 ? 'claim waits' : 'claims wait'} for you`} meta="Review one at a time" onOpen={openReview} action={{ icon: 'check', label: 'Review', run: openReview }} />;
      case 'dm': {
        const c = x.chat;
        return (
          <Swipe key={c.profile + c.id} onLeft={() => n.dismissChat(c)} leftLabel="Dismiss" leftIcon="close">
            <CardRow title={c.name} meta={`DM · ${c.last_at ? `${ago(c.last_at, ' ago')} · ` : ''}${c.summary ?? ''}`} onOpen={() => setView({ person: c.name })}
              menu={(
                <>
                  <MenuItem icon="add" onClick={() => n.chatTask(c)}>Make a task</MenuItem>
                  {slackLink(c.url)}
                  <MenuItem icon="note" onClick={() => n.chatNote(c)}>Nothing asked</MenuItem>
                  <MenuItem icon="close" onClick={() => n.dismissChat(c)}>Dismiss</MenuItem>
                </>
              )} />
          </Swipe>
        );
      }
      case 'slack':
        return (
          <Swipe key={x.keys[0]} onLeft={() => n.dismissBullet(x.brief, x.x)} leftLabel="Dismiss" leftIcon="close">
            <CardRow title={x.x.title} meta={`Slack${x.x.why ? ` · ${x.x.why}` : ''}`} onOpen={() => setView({ list: 'summary', open: null })}
              menu={(
                <>
                  <MenuItem icon="add" onClick={() => n.bulletTask(x.brief, x.x)}>Make a task</MenuItem>
                  {slackLink(x.x.url)}
                  <MenuItem icon="note" onClick={() => n.bulletNote(x.brief, x.x)}>Nothing asked</MenuItem>
                  <MenuItem icon="close" onClick={() => n.dismissBullet(x.brief, x.x)}>Dismiss</MenuItem>
                </>
              )} />
          </Swipe>
        );
    }
  };
  const collapsed = n.rows.find((x) => x.kind === 'overdueAll');
  return (
    <>
      {groupNeeds(n.rows).map((g) => {
        const all = expanded.includes(g.key);
        return (
          <section key={g.key}>
            <Section label={g.label} count={sectionCount(g.rows.length)}
              action={g.key === 'tasks' && collapsed?.kind === 'overdueAll' && <Button variant="quiet" size="sm" onClick={() => moveToday(collapsed.rows)}>Move {collapsed.rows.length} overdue to today</Button>} />
            <div className="as-group ov-queue-group">
              {(all ? g.rows : g.rows.slice(0, CAP)).map(rowOf)}
              {!all && g.rows.length > CAP && (
                <AskRow title={`Show all ${g.rows.length}`} onClick={() => setExpanded([...expanded, g.key])} />
              )}
            </div>
          </section>
        );
      })}
    </>
  );
}
