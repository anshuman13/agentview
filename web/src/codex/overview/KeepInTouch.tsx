import { useMemo, useRef, useState } from 'react';
import { useAssistantData } from '../data';
import { displayName } from '../data/meetings';
import { keepInTouch, type Lapsed } from '../data/review';
import { plural, save, stored } from '../../ui/util';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { Button, IconButton } from '../../ui/Button';
import { dayLabel } from '../data/dates';
import { focusPast, setView, useView } from '../view';

const TOUCH_DISMISSED = 'codex.keepInTouch';
const SHOWN = 5;

// People I usually meet or DM who have gone quiet for over 1.5x their usual gap: Dismiss hides them until the next contact.
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

export function KeepInTouch({ k }: { k: ReturnType<typeof useKeepInTouch> }) {
  const list = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const [all, setAll] = useState(false);
  const { shown } = k;
  const dismiss = (x: Lapsed, i: number) => {
    k.dismiss(x);
    // Focus the person that moved into this row, or the one above when the last went.
    requestAnimationFrame(() => {
      const people = list.current?.querySelectorAll<HTMLElement>('button[data-open]');
      people?.[Math.min(i, people.length - 1)]?.focus();
    });
    focusPast(section.current);
  };
  if (!shown.length) return null;
  return (
    <section ref={section}>
      <Section label="Keep in touch" count={shown.length} />
      <div className="as-group" ref={list}>
        {(all ? shown : shown.slice(0, SHOWN)).map((x, i) => (
          <Row key={x.key} plain title={displayName(x.name)}
            meta={`Last ${dayLabel(x.last)} · every ${plural(Math.max(1, Math.round(x.gap / 86400000)), 'day')}`}
            trailing={<>
              <IconButton icon="arrow-right" size="sm" small label={`Open ${x.name}`} data-open onClick={() => setView({ person: x.name })} />
              <IconButton icon="close" size="sm" small label={`Dismiss ${x.name}`} onClick={() => dismiss(x, i)} />
            </>} />
        ))}
        {!all && shown.length > SHOWN && <Button variant="quiet" size="sm" onClick={() => setAll(true)}>Show all {shown.length}</Button>}
      </div>
    </section>
  );
}
