import { useState } from 'react';
import { useAssistantData } from './data';
import { save, stored } from '../ui/util';
import { Icon } from '../ui/Icon';
import { useView } from './view';
import { clock } from './time';

const DISMISSED = 'codex.briefDismissed';
const COLLAPSED = 'codex.briefCollapsed';
const DAY = 86400000;
const PREVIEW_LINES = 3;

function BriefBody({ rest }: { rest: string[] }) {
  const [all, setAll] = useState(false);
  const lines = rest.filter((l) => l.trim());
  const long = lines.length > PREVIEW_LINES;
  return (
    <>
      <div className="ov-report full">{all || !long ? rest.join('\n') : lines.slice(0, PREVIEW_LINES).join('\n')}</div>
      {long && <button className="as-chip quiet ov-more" onClick={() => setAll(!all)}>{all ? 'Show less' : 'Show all'}</button>}
    </>
  );
}

// Today's morning brief from the hub, one per profile, shown for a day from the hub's midnight in any time zone: the header folds it, the cross hides it until tomorrow.
export function MorningBrief({ now }: { now: number }) {
  const snap = useAssistantData();
  const { filter } = useView();
  const [dismissed, setDismissed] = useState<string[]>(() => stored<string[]>(DISMISSED, []));
  const [collapsed, setCollapsed] = useState(() => stored(COLLAPSED, false));
  const briefs = snap.briefs.filter((b) => !b.deleted && b.kind === 'morning' && b.from_at != null && now >= b.from_at && now - b.from_at < DAY && b.text && (filter === 'all' || b.profile === filter) && !dismissed.includes(b.profile + b.id))
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
            {title}{filter === 'all' ? ` · ${b.profile}` : ''} · {clock(b.to_at ?? b.from_at!)} <Icon name={collapsed ? 'chevron-down' : 'chevron-up'} small />
          </button>
          <button className="icon-btn" title="Hide until tomorrow" aria-label="Hide the brief until tomorrow" onClick={() => dismiss(b)}><Icon name="close" small /></button>
        </div>
        {!collapsed && <BriefBody rest={rest} />}
      </section>
    );
  });
}
