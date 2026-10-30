import { useAssistant } from './data';
import { errorText, nextNine } from './data/engine';
import { nextRepeat } from './data/recur';
import type { Patch } from './data/store';
import type { ItemRow, Profile } from './data/sync';
import { FILTER_LABEL, showSnack } from './view';
import { when } from './time';

export const UNROLL = { rolls: null, rolled_from: null };

export function useActions() {
  const { store } = useAssistant();
  const change = (r: ItemRow, patch: Patch, text: string) => {
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, r[k as keyof ItemRow]])) as Patch;
    void store.update(r, patch);
    showSnack(text, () => void store.update(r, before));
  };
  return {
    done: (r: ItemRow) => {
      const next = nextRepeat(r, Date.now(), store.snapshot().items);
      if (!next) return change(r, { status: 'done' }, 'Done');
      const made = store.capture(`${next.title}\n${next.text}`, 'task', r.profile, next.at).catch(() => null);
      void store.update(r, { status: 'done' });
      showSnack(`Done · next ${when(next.at)}`, () => {
        void store.update(r, { status: r.status });
        void made.then((n) => n && store.update(n, { deleted: 1 }));
      });
    },
    reopen: (r: ItemRow) => change(r, { status: 'open' }, 'Moved back to Today'),
    snooze: (r: ItemRow, at = nextNine()) => change(r, { at, ...UNROLL }, `Snoozed to ${when(at)}`),
    remove: (r: ItemRow) => change(r, { deleted: 1 }, 'Deleted'),
    toTask: (r: ItemRow) => change(r, { status: 'open', ...UNROLL }, 'Moved to Today'),
    due: (r: ItemRow, at: number | null) => change(r, { at, ...UNROLL }, at == null ? 'Due time cleared' : `Due ${when(at)}`),
    edit: (r: ItemRow, patch: Patch) => void store.update(r, patch),
    move: (r: ItemRow, to: Profile) => store.move(r, to).then(() => showSnack(`Moved to ${FILTER_LABEL[to]}`, () => {
      const moved = store.snapshot().items.find((x) => x.profile === to && x.id === r.id);
      void store.move(moved ?? { ...r, profile: to }, r.profile).catch((err) => showSnack(`Not moved: ${errorText(err)}`));
    }), (err) => showSnack(`Not moved: ${errorText(err)}`)),
  };
}
