import { useAssistant } from './data';
import type { AssistantStore } from './data/store';
import { plural } from '../ui/util';
import { atTime, errorText, nextNine } from './data/engine';
import { dayEnd } from './data/dates';
import { nextRepeat } from './data/recur';
import { snoozeLaterAt, todayAt } from './data/reschedule';
import type { Patch } from './data/store';
import type { ItemRow, Profile } from './data/sync';
import { stopFocusFor } from './focus';
import { FILTER_LABEL, showSnack } from './view';
import { when } from './time';

// A reschedule to a future day starts over, so it clears the rollover history; one to today or earlier keeps it.
export const UNROLL = { rolls: null, rolled_from: null };
export const unrollFor = (at: number | null | undefined, now = Date.now()) => (at != null && at >= dayEnd(now) ? UNROLL : {});

const capturing = new Set<string>();

type BulkStore = Pick<AssistantStore, 'update' | 'capture' | 'snapshot'>;
export type BulkKind = 'done' | 'tomorrow' | 'snooze' | 'delete' | 'clear';
const sameRow = (a: ItemRow, b: ItemRow) => a.profile === b.profile && a.id === b.id;

// Marks one task done, creating its next repeat; null when that repeat is already being created.
function markDone(store: BulkStore, r: ItemRow) {
  stopFocusFor(r);
  const next = nextRepeat(r, Date.now(), store.snapshot().items);
  if (!next) {
    void store.update(r, { status: 'done' });
    return { next, undo: () => void store.update(r, { status: r.status }) };
  }
  const key = r.profile + r.id;
  if (capturing.has(key)) return null;
  capturing.add(key);
  const made = store.capture(`${next.title}\n${next.text}`, 'task', r.profile, next.at).catch((err) => (showSnack(`Next repeat not created: ${errorText(err)}`), null));
  void Promise.allSettled([made, store.update(r, { status: 'done' })]).then(() => capturing.delete(key));
  return {
    next,
    undo: () => {
      void store.update(r, { status: r.status });
      void made.then((n) => n && store.update(n, { deleted: 1 }));
    },
  };
}

// One action on every selected task with one snack and one undo. Undo skips a row that was changed since.
export function bulkApply(store: BulkStore, rows: ItemRow[], kind: BulkKind, now = Date.now()) {
  const applied: { r: ItemRow; patch: Patch; undo: (cur: ItemRow) => void }[] = [];
  for (const r of rows) {
    if (kind === 'done') {
      const d = markDone(store, r);
      if (d) applied.push({ r, patch: { status: 'done' }, undo: d.undo });
      continue;
    }
    const at = kind === 'tomorrow' ? nextNine(new Date(now), r.profile) : snoozeLaterAt(r.at, now, r.profile);
    const removes = kind === 'delete' || kind === 'clear';
    const patch: Patch = removes ? { deleted: 1 } : { at, ...(kind === 'tomorrow' ? UNROLL : unrollFor(at, now)) };
    if (removes) stopFocusFor(r);
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, r[k as keyof ItemRow]])) as Patch;
    void store.update(r, patch);
    applied.push({ r, patch, undo: (cur) => void store.update(cur, before) });
  }
  const n = applied.length;
  if (!n) return;
  const text = {
    done: `Done ${plural(n, 'task')}`,
    tomorrow: `Moved ${plural(n, 'task')} to ${when(nextNine(new Date(now), rows[0].profile), now)}`,
    snooze: `Snoozed ${plural(n, 'task')}`,
    delete: `Deleted ${plural(n, 'task')}`,
    clear: `Cleared ${n}`,
  }[kind];
  showSnack(text, () => {
    const items = store.snapshot().items;
    for (const { r, patch, undo } of applied) {
      const cur = items.find((x) => sameRow(x, r));
      if (cur && Object.entries(patch).every(([k, v]) => (cur[k as keyof ItemRow] ?? null) === (v ?? null))) undo(cur);
    }
  });
}

export function useActions() {
  const { store } = useAssistant();
  const change = (r: ItemRow, patch: Patch, text: string) => {
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, r[k as keyof ItemRow]])) as Patch;
    void store.update(r, patch);
    showSnack(text, () => void store.update(r, before));
  };
  return {
    done: (r: ItemRow) => {
      const d = markDone(store, r);
      if (d) showSnack(d.next ? `Done · next ${when(d.next.at)}` : 'Done', d.undo);
    },
    snoozeAsk: (r: ItemRow, until: number) => change(r, { snoozed_until: until }, `Snoozed to ${when(until)}`),
    tomorrow: (r: ItemRow) => { const at = nextNine(undefined, r.profile); change(r, { at, ...UNROLL }, `Moved to ${when(at)}`); },
    reopen: (r: ItemRow) => change(r, { status: 'open' }, 'Moved back to Today'),
    snooze: (r: ItemRow, at = nextNine(undefined, r.profile)) => change(r, { at, ...unrollFor(at) }, `Snoozed to ${when(at)}`),
    // Tomorrow 09:00, or the next 09:00 after the due time when that is later.
    snoozeLater: (r: ItemRow, now = Date.now()) => { const at = snoozeLaterAt(r.at, now, r.profile); change(r, { at, ...unrollFor(at) }, `Snoozed to ${when(at)}`); },
    // Overdue tasks move to today at their own time of day with one undo for the lot.
    moveToToday: (rows: ItemRow[], now = Date.now()) => {
      const before = rows.map((r) => ({ r, at: r.at, rolls: r.rolls, rolled_from: r.rolled_from }));
      for (const r of rows) void store.update(r, { at: todayAt(r.at, now), ...UNROLL });
      showSnack('Moved to today', () => before.forEach(({ r, ...prev }) => void store.update(r, prev)));
    },
    bulk: (rows: ItemRow[], kind: BulkKind) => bulkApply(store, rows, kind),
    remove: (r: ItemRow) => {
      stopFocusFor(r);
      change(r, { deleted: 1 }, 'Deleted');
    },
    toTask: (r: ItemRow) => change(r, { status: 'open', ...unrollFor(atTime(r.at)) }, 'Moved to Today'),
    skip: (r: ItemRow, at: number) => change(r, { at, ...unrollFor(at) }, `Skipped · next ${when(at)}`),
    due: (r: ItemRow, at: number | null) => change(r, { at, ...unrollFor(at) }, at == null ? 'Due time cleared' : `Due ${when(at)}`),
    edit: (r: ItemRow, patch: Patch) => void store.update(r, patch),
    move: (r: ItemRow, to: Profile) => store.move(r, to).then(() => showSnack(`Moved to ${FILTER_LABEL[to]}`, () => {
      const moved = store.snapshot().items.find((x) => x.profile === to && x.id === r.id);
      void store.move(moved ?? { ...r, profile: to }, r.profile, r.goal).catch((err) => showSnack(`Not moved: ${errorText(err)}`));
    }), (err) => showSnack(`Not moved: ${errorText(err)}`)),
  };
}
