import { useState } from 'react';
import { live, type Brief } from '../data/wiki/wiki';
import type { Filter } from '../view';
import { morningLines, parseMorningRows } from '../../../../shared/morning';
import { IconButton } from '../../ui/Button';
import { save, stored } from '../../ui/util';

const DISMISSED = 'codex:morning:dismissed';

// Today's morning brief at the top of Overview, as Duet writes it: the headline, then one "Topic: status" line each; Close hides it for the day.
export function MorningCard({ briefs, filter, now }: { briefs: Brief[]; filter: Filter; now: number }) {
  const [hidden, setHidden] = useState(() => stored<string[]>(DISMISSED, []));
  const day = new Date(now).setHours(0, 0, 0, 0);
  const all = live(briefs).filter((b) => b.kind === 'morning' && b.from_at === day && (filter === 'all' || b.profile === filter));
  const today = all.filter((b) => !hidden.includes(b.profile + b.id));
  if (!today.length) return null;
  const close = (b: Brief) => {
    const next = [...hidden.filter((k) => all.some((x) => x.profile + x.id === k)), b.profile + b.id];
    save(DISMISSED, next);
    setHidden(next);
  };
  return (
    <>
      {today.map((b) => (
        <section key={b.profile + b.id} className="ov-morning">
          <div className="ov-morning-head">
            <strong>{filter === 'all' && `${b.profile === 'work' ? 'Work' : 'Personal'} · `}{b.text}</strong>
            <IconButton size="sm" icon="close" label="Close brief" onClick={() => close(b)} />
          </div>
          <ul>
            {morningLines(parseMorningRows(b.rows)).map((l) => <li key={l.label}><b>{l.label}:</b> {l.text}</li>)}
          </ul>
        </section>
      ))}
    </>
  );
}
