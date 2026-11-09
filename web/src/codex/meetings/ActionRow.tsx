import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useAssistantStore } from '../data';
import { atTime } from '../data/tasks/engine';
import type { AssistantStore, Patch } from '../data/store';
import { draftFor } from '../data/meetings/meetingMarkdown';
import { displayName, peopleOf } from '../data/meetings/meetings';
import { firstName } from '../data/meetings/points';
import type { ItemRow } from '../data/sync';
import type { Meeting } from '../data/wiki/wiki';
import { PickTime, when } from '../tasks/time';
import { snoozeText, snoozes } from '../AskBar';
import { Icon } from '../../ui/Icon';
import { Button, IconButton } from '../../ui/Button';
import { Row } from '../../ui/Row';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { haptic } from '../../ui/haptic';
import { copyText, openTask, showSnack } from '../view';
import { Swipe } from '../gestures/Swipe';
import { safeHref } from '../../ui/util';
import { UNROLL, useActions } from '../useActions';
import { type BadgeSpec, Badge } from '../../ui/Badge';

// Matches STALE in assistant/src/rollover.ts: at this many rolls a task goes back to review.
const STALE_ROLLS = 3;

// Opens Linear's new-issue form filled in; nothing is created until you submit it there.
const linearIssue = (r: ItemRow, m: Meeting) => `https://linear.app/new?${new URLSearchParams({ title: r.title ?? '', description: draftFor(r, m).split('\n').slice(1).join('\n') })}`;

export function confirmAll(store: AssistantStore, rows: ItemRow[]) {
  for (const r of rows) void store.update(r, { status: 'open' });
  showSnack(`${rows.length} added to Today`, () => rows.forEach((r) => void store.update(r, { status: r.status })));
}

export function dismissAll(store: AssistantStore, rows: ItemRow[]) {
  for (const r of rows) void store.update(r, { status: 'dismissed' });
  showSnack(`${rows.length} dismissed`, () => rows.forEach((r) => void store.update(r, { status: r.status })));
}

const Pop = ({ anchor, children }: { anchor: RefObject<HTMLElement | null>; children: ReactNode }) => {
  const r = anchor.current!.getBoundingClientRect();
  const up = r.bottom + 320 > window.innerHeight && r.top > window.innerHeight - r.bottom;
  return createPortal(<div className={up ? 'mt-pop up' : 'mt-pop'} style={{ top: up ? r.top : r.bottom, right: window.innerWidth - r.right }}>{children}</div>, document.body);
};

// An action from a meeting: a title, a meta line, one button for its status and a kebab with the rest. Suggested ones
// are kept (Today) or dismissed (Not mine, by swipe or n); unassigned ones can be taken; dismissed ones restored.
export function ActionRow({ row, meeting, meta: metaText, extraItems }: { row: ItemRow; meeting?: Meeting; meta?: string; extraItems?: (close: (f: () => void) => () => void) => ReactNode }) {
  const store = useAssistantStore();
  const act = useActions();
  const [menu, setMenu] = useState<'more' | 'assign' | 'snooze' | null>(null);
  const kebab = useRef<HTMLButtonElement>(null);
  const change = (patch: Patch, text: string) => {
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, row[k as keyof ItemRow]])) as Patch;
    void store.update(row, patch);
    showSnack(text, () => void store.update(row, before));
  };
  const status = row.status ?? '';
  const done = status === 'done';
  const at = atTime(row.at);
  const accept = () => change({ status: 'open', ...((row.rolls ?? 0) >= STALE_ROLLS && UNROLL) }, 'Added to Today');
  const dismiss = () => change({ status: 'dismissed' }, meeting ? 'Moved to Not mine' : 'Dismissed');
  const check = () => { haptic(done ? 'tap' : 'success'); change({ status: done ? 'open' : 'done' }, done ? 'Moved back to Today' : 'Done'); };
  const suggestedRows =() => [...document.querySelectorAll<HTMLElement>('.mt-act.suggested')];
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.currentTarget;
    const step = e.key === 'j' || e.key === 'ArrowDown' ? 1 : e.key === 'k' || e.key === 'ArrowUp' ? -1 : 0;
    const yes = e.key === 'y' || e.key === 'Enter';
    const no = e.key === 'n' || e.key === 'Delete' || e.key === 'Backspace';
    if (!step && !yes && !no) return;
    e.preventDefault();
    e.stopPropagation();
    const rows = suggestedRows();
    const i = rows.indexOf(el);
    if (step) return rows[i + step]?.focus();
    if (yes) accept();
    else dismiss();
    let tries = 0;
    const move = () => {
      if (el.isConnected) {
        if (++tries < 20) requestAnimationFrame(move);
        return;
      }
      const left = suggestedRows();
      (left[i] ?? left[i - 1])?.focus();
    };
    requestAnimationFrame(move);
  };
  const cur = row.assignee || null;
  const names = meeting ? peopleOf(meeting) : [];
  const pickWho = (who: string | null) => {
    setMenu(null);
    if (who === cur) return;
    change({ assignee: who }, who ? `Assigned to ${firstName(displayName(who))}` : 'Assigned to me');
  };
  const mark = (on: boolean) => on && <Icon name="check" small />;
  const late = status === 'open' && at != null && at < Date.now();
  const badge: BadgeSpec | null = status === 'suggested' ? { status: 'waiting', label: 'Needs you' } : late ? { status: 'late', reason: 'Overdue' } : done ? { status: 'done' } : null;
  const meta = metaText ?? [(status === 'open' || status === 'suggested') && at != null && when(at), cur && firstName(displayName(cur)), row.text].filter(Boolean).join(' · ');
  const primary = {
    open: ['Done', check],
    done: ['Not done', check],
    suggested: ['Mine', accept],
    unassigned: ['Take it', () => change({ status: 'open' }, 'Added to Today')],
    dismissed: ['Restore', () => change({ status: 'suggested' }, 'Back to review')],
  }[status] as [string, () => void] | undefined;
  const close = (f: () => void) => () => { setMenu(null); f(); };
  const snoozable = status === 'open' || status === 'suggested';
  const el = (
    <Row
      plain
      className={`mt-act ${status}`}
      {...(status === 'suggested' && { tabIndex: 0, onKeyDown })}
      title={row.title}
      meta={meta}
      trailing={<>
        {badge && <Badge {...badge} />}
        {primary && <Button size="sm" onClick={primary[1]}>{primary[0]}</Button>}
        <IconButton ref={kebab} icon="kebab-horizontal" size="sm" small label="More" aria-haspopup="menu" aria-expanded={menu != null} onClick={() => setMenu(menu === 'more' ? null : 'more')} />
        {menu && <Pop anchor={kebab}>
          {menu === 'more' && (
            <Menu trigger={kebab} onClose={() => setMenu(null)}>
              {extraItems?.(close)}
              {snoozable && <MenuItem onClick={close(dismiss)}>Not mine</MenuItem>}
              {meeting && status === 'open' && <MenuItem onClick={() => setMenu('assign')}>Assign</MenuItem>}
              {snoozable && <MenuItem onClick={() => setMenu('snooze')}>Snooze</MenuItem>}
              <MenuItem onClick={close(() => openTask(row))}>Edit</MenuItem>
              {meeting && status === 'open' && <MenuItem href={linearIssue(row, meeting)} onClick={() => setMenu(null)}>New Linear issue</MenuItem>}
              {meeting && <MenuItem onClick={close(() => copyText(draftFor(row, meeting)))}>Copy as message</MenuItem>}
              {!meeting && row.source_url && <MenuItem href={safeHref(row.source_url)} onClick={() => setMenu(null)}>Open source</MenuItem>}
              {!meeting && row.draft && <MenuItem onClick={close(() => copyText(row.draft!))}>Copy draft</MenuItem>}
              <MenuSeparator />
              <MenuItem danger onClick={close(() => act.remove(row))}>Delete</MenuItem>
            </Menu>
          )}
          {menu === 'assign' && (
            <Menu trigger={kebab} onClose={() => setMenu(null)}>
              <MenuItem aria-checked={!cur} onClick={() => pickWho(null)}>{mark(!cur)}Me</MenuItem>
              {(cur && !names.includes(cur) ? [cur, ...names] : names).map((n) => <MenuItem key={n} aria-checked={n === cur} onClick={() => pickWho(n)}>{mark(n === cur)}{displayName(n)}</MenuItem>)}
            </Menu>
          )}
          {menu === 'snooze' && (
            <Menu trigger={kebab} onClose={() => setMenu(null)}>
              {snoozes().map((s) => <MenuItem key={s.label} onClick={close(() => act.snooze(row, s.at(new Date(), row.profile)))}>{snoozeText(s, new Date(), row.profile)}</MenuItem>)}
              <PickTime className="ui-menu-item" label="Pick date" value={at} onPick={(t) => close(() => act.snooze(row, t))()} />
            </Menu>
          )}
        </Pop>}
      </>}
    />
  );
  if (status !== 'open') return el;
  return <Swipe onRight={check} onLeft={dismiss} leftLabel="Dismiss" leftIcon="close">{el}</Swipe>;
}
