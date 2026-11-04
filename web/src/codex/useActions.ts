import { useAssistant } from './data';
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

export function useActions() {
  const { store } = useAssistant();
  const change = (r: ItemRow, patch: Patch, text: string) => {
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, r[k as keyof ItemRow]])) as Patch;
    void store.update(r, patch);
    showSnack(text, () => void store.update(r, before));
  };
  return {
    done: (r: ItemRow) => {
      stopFocusFor(r);
      const next = nextRepeat(r, Date.now(), store.snapshot().items);
      if (!next) return change(r, { status: 'done' }, 'Done');
      const key = r.profile + r.id;
      if (capturing.has(key)) return;
      capturing.add(key);
      const made = store.capture(`${next.title}\n${next.text}`, 'task', r.profile, next.at).catch((err) => (showSnack(`Next repeat not created: ${errorText(err)}`), null));
      void Promise.allSettled([made, store.update(r, { status: 'done' })]).then(() => capturing.delete(key));
      showSnack(`Done · next ${when(next.at)}`, () => {
        void store.update(r, { status: r.status });
        void made.then((n) => n && store.update(n, { deleted: 1 }));
      });
    },
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
    remove: (r: ItemRow) => {
      stopFocusFor(r);
      change(r, { deleted: 1 }, 'Deleted');
    },
    toTask: (r: ItemRow) => change(r, { status: 'open', ...unrollFor(atTime(r.at)) }, 'Moved to Today'),
    due: (r: ItemRow, at: number | null) => change(r, { at, ...unrollFor(at) }, at == null ? 'Due time cleared' : `Due ${when(at)}`),
    edit: (r: ItemRow, patch: Patch) => void store.update(r, patch),
    move: (r: ItemRow, to: Profile) => store.move(r, to).then(() => showSnack(`Moved to ${FILTER_LABEL[to]}`, () => {
      const moved = store.snapshot().items.find((x) => x.profile === to && x.id === r.id);
      void store.move(moved ?? { ...r, profile: to }, r.profile, r.goal).catch((err) => showSnack(`Not moved: ${errorText(err)}`));
    }), (err) => showSnack(`Not moved: ${errorText(err)}`)),
  };
}
