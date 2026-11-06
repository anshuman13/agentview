import { useMemo, useRef, useState } from 'react';
import { useAssistantData, useAssistantStore } from '../data';
import { firstName, pointsOf } from '../data/points';
import { raise } from '../meetings/Raise';
import { displayName } from '../data/meetings';
import { keepInTouch, touchText, type Lapsed } from '../data/review';
import { plural, save, stored } from '../../ui/util';
import { dayLabel } from '../data/dates';
import { Capped, SectionHead } from '../Fold';
import { Icon } from '../../ui/Icon';
import { copyText, focusPast, setView, useView } from '../view';

const TOUCH_DISMISSED = 'codex.keepInTouch';

// People I usually meet or DM who have gone quiet for over 1.5x their usual gap: Copy nudge copies a short line, Dismiss hides them until the next contact.
export function useKeepInTouch() {
  const snap = useAssistantData();
  const { filter } = useView();
  const [dismissed, setDismissed] = useState<string[]>(() => stored<string[]>(TOUCH_DISMISSED, []));
  const hour = Math.floor(Date.now() / 3600_000);
  const rows = useMemo(() => {
    const pick = <T extends { profile: string }>(xs: T[]) => xs.filter((x) => filter === 'all' || x.profile === filter);
    // The current time, as a contact from this hour would be past an hour-rounded now and not count.
    return keepInTouch(pick(snap.meetings), pick(snap.chats), pick(snap.items), Date.now());
  }, [snap.meetings, snap.chats, snap.items, filter, hour]);
  const shown = rows.filter((x) => !dismissed.includes(x.key));
  const dismiss = (x: Lapsed) => {
    const next = [...(filter === 'all' ? dismissed.filter((k) => rows.some((r) => r.key === k)) : dismissed), x.key];
    setDismissed(next);
    save(TOUCH_DISMISSED, next);
  };
  return { shown, dismiss };
}

function TouchNote({ x }: { x: Lapsed }) {
  const store = useAssistantStore();
  const [text, setText] = useState('');
  const save = async () => {
    const t = text.trim();
    if (t && await raise(store, t, x.name, x.profile)) setText('');
  };
  return (
    <input className="ov-follow-note" value={text} placeholder="Talk about next time" aria-label={`Note for ${x.name}`} enterKeyHint="done"
      onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} />
  );
}

export function KeepInTouch({ k }: { k: ReturnType<typeof useKeepInTouch> }) {
  const list = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const { shown } = k;
  const { items } = useAssistantData();
  const dismiss = (x: Lapsed, i: number) => {
    k.dismiss(x);
    // Focus the person that moved into this row, or the one above when the last went.
    requestAnimationFrame(() => {
      const people = list.current?.querySelectorAll<HTMLElement>('button.ov-follow-text');
      people?.[Math.min(i, people.length - 1)]?.focus();
    });
    focusPast(section.current);
  };
  if (!shown.length) return null;
  return (
    <section ref={section}>
      <SectionHead title="Keep in touch" count={shown.length} />
      <div className="ov-follow" role="list" aria-label="Keep in touch" ref={list}>
        <Capped items={shown} render={(x, i) => {
          const points = pointsOf(items, x.name);
          const next = points.length ? `Next: ${points[points.length - 1].title}${points.length > 1 ? ` +${points.length - 1}` : ''}` : '';
          return (
          <div key={x.key} className="ov-follow-row wrap" role="listitem">
            <button className="ov-follow-text" onClick={() => setView({ person: x.name })}>
              <span className="ov-t">{displayName(x.name)}</span>
              <span className="muted small">last {dayLabel(x.last)} · usually every {plural(Math.max(1, Math.round(x.gap / 86400000)), 'day')}</span>
              {next && <span className="muted small ov-follow-next">{next}</span>}
            </button>
            <button className="btn btn-sm btn-gray" aria-label={`Copy a nudge to ${x.name}`} onClick={() => copyText(touchText(x.name), 'Nudge copied')}><Icon name="copy" small /> Copy nudge</button>
            <button className="btn btn-sm btn-gray" aria-label={`Dismiss ${x.name}`} onClick={() => dismiss(x, i)}>Dismiss</button>
            <TouchNote x={x} />
          </div>
          );
        }} />
      </div>
    </section>
  );
}
