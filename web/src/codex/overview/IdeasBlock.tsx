import { useState } from 'react';
import type { ItemRow } from '../data/sync';
import { atTime } from '../data/tasks/engine';
import { ideaTitle, pickIdeas } from '../../../../shared/ideas';
import { Icon } from '../../ui/Icon';
import { MenuItem } from '../../ui/Menu';
import { Section } from '../../ui/Section';
import { haptic } from '../../ui/haptic';
import { save, storedStrings } from '../../ui/util';
import { when } from '../tasks/time';
import { CardRow } from './CardRow';

const HIDDEN = 'codex:ideas:hidden';

// Muse's Ideas: up to three open tasks an agent could take on, each as "I can help: …"; Start asks Codex about it, Not now hides it.
export function IdeasBlock({ tasks, now, onAsk }: { tasks: ItemRow[]; now: number; onAsk: (r: ItemRow) => void }) {
  const [hidden, setHidden] = useState(() => storedStrings(HIDDEN));
  const ideas = pickIdeas(tasks.filter((r) => r.status === 'open').map((r) => ({ r, title: r.title, due: atTime(r.at), key: r.profile + r.id })), hidden);
  if (!ideas.length) return null;
  const hide = (key: string) => {
    const next = [...hidden.slice(-49), key];
    save(HIDDEN, next);
    setHidden(next);
  };
  return (
    <section>
      <Section label="Ideas" />
      <div className="as-group">
        {ideas.map(({ r, due, key }) => (
          <CardRow key={key} leading={<Icon name="lightbulb" />} title={ideaTitle(r.title ?? '')}
            meta={due == null ? 'No due date' : due < now ? `Overdue · was due ${when(due, now)}` : `Due ${when(due, now)}`}
            onOpen={() => onAsk(r)} button={{ label: 'Start', run: () => { haptic('tap'); onAsk(r); } }}
            menu={<MenuItem icon="close" onClick={() => hide(key)}>Not now</MenuItem>} />
        ))}
      </div>
    </section>
  );
}
