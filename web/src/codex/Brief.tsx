import { useState } from 'react';
import { useAssistantData } from './data';
import { dayStart } from './data/dates';
import { save, stored } from '../ui/util';
import { Icon } from '../ui/Icon';
import { useView } from './view';
import { clock } from './time';

const DISMISSED = 'codex.briefDismissed';
const COLLAPSED = 'codex.briefCollapsed';

// Today's morning brief from the hub, one per profile: the header folds it, the cross hides it until tomorrow.
export function MorningBrief({ now }: { now: number }) {
  const snap = useAssistantData();
  const { filter } = useView();
  const [dismissed, setDismissed] = useState<string[]>(() => stored<string[]>(DISMISSED, []));
  const [collapsed, setCollapsed] = useState(() => stored(COLLAPSED, false));
  const today = dayStart(now);
  const briefs = snap.briefs.filter((b) => !b.deleted && b.kind === 'morning' && b.from_at === today && b.text && (filter === 'all' || b.profile === filter) && !dismissed.includes(b.profile + b.id))
    .sort((a, b) => Number(b.profile === 'work') - Number(a.profile === 'work'));
  if (!briefs.length) return null;
  const toggle = () => { save(COLLAPSED, !collapsed); setCollapsed(!collapsed); };
  const dismiss = (b: (typeof briefs)[number]) => {
    const next = [...dismissed.filter((k) => k.endsWith(b.id)), b.profile + b.id];
    setDismissed(next);
    save(DISMISSED, next);
  };
  return briefs.map((b) => {
    const [title, ...rest] = b.text!.split('\n');
    return (
      <section key={b.profile + b.id}>
        <div className="ov-brief-head">
          <button className="as-section as-toggle" aria-expanded={!collapsed} onClick={toggle}>
            {title}{filter === 'all' ? ` · ${b.profile}` : ''} · {clock(b.to_at ?? today)} <Icon name={collapsed ? 'chevron-down' : 'chevron-up'} small />
          </button>
          <button className="icon-btn" title="Hide until tomorrow" aria-label="Hide the brief until tomorrow" onClick={() => dismiss(b)}><Icon name="close" small /></button>
        </div>
        {!collapsed && <div className="ov-report full">{rest.join('\n')}</div>}
      </section>
    );
  });
}
