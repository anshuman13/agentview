import { useMemo, useState } from 'react';
import { useAssistantTable } from '../data';
import { rowKey } from '../data/sync';
import type { Brief } from '../data/wiki';
import { Button, IconButton } from '../../ui/Button';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { save, stored } from '../../ui/util';
import { clock } from '../time';
import { openTask } from '../view';
import { visibleRows, type DigestGroup, type DigestRow } from './digest';

type Parsed = { groups: DigestGroup[]; waiting: DigestRow[] };

function GroupList({ brief, group, items }: { brief: Brief; group: DigestGroup; items: Set<string> }) {
  const key = `codex.digestFold.${brief.profile}:${brief.id}:${group.outcome}`;
  const [open, setOpen] = useState(() => stored<boolean>(key, group.open));
  const [all, setAll] = useState(false);
  const toggle = () => { save(key, !open); setOpen(!open); };
  const rows = visibleRows(group, all);
  return (
    <>
      <Section label={group.label} count={group.rows.length} open={open} onToggle={toggle} />
      {open && rows.map((r) => {
        const exists = items.has(rowKey({ profile: brief.profile, id: r.id }));
        const badge = r.outcome === 'failed' ? 'Failed' : r.outcome === 'escalated' ? 'Needs you' : r.outcome === 'sent' && r.edited ? 'Edited' : '';
        return (
          <div key={r.id} className="ov-digest-row">
            <Row className={exists ? '' : 'inert'} disabled={!exists} title={r.who || 'Slack'} meta={[r.chat, r.reason].filter(Boolean).join(' · ')} trailing={badge && <span className="badge quiet">{badge}</span>} onClick={() => openTask({ profile: brief.profile, id: r.id })} />
            {r.url && <IconButton icon="link-external" label="Open" size="sm" onClick={() => window.open(r.url, '_blank', 'noreferrer')} />}
          </div>
        );
      })}
      {open && !all && rows.length < group.rows.length && <Button variant="quiet" size="sm" className="ov-more" onClick={() => setAll(true)}>Show all {group.rows.length}</Button>}
    </>
  );
}

// The day or away digest as a report card: counts in the header, one folded or open list per outcome, and a link to the Reply queue for what still waits.
export function DigestCard({ brief, digest, showProfile, onDismiss }: { brief: Brief; digest: Parsed; showProfile: boolean; onDismiss: () => void }) {
  const itemRows = useAssistantTable('items');
  const items = useMemo(() => new Set(itemRows.filter((r) => !r.deleted).map(rowKey)), [itemRows]);
  const waiting = digest.waiting.filter((r) => {
    const item = itemRows.find((i) => i.profile === brief.profile && i.id === r.id);
    return item && !item.deleted && (item.status === 'suggested' || item.status === 'open');
  }).length;
  return (
    <section className="ov-digest">
      <Section label={`${brief.text}${showProfile ? ` · ${brief.profile}` : ''}`} action={(
        <span className="ov-digest-head">
          {digest.groups.map((g) => <span key={g.outcome} className="badge quiet">{g.rows.length} {g.outcome}</span>)}
          <span>{clock(brief.to_at ?? brief.from_at!)}</span>
          <IconButton icon="close" label="Hide until tomorrow" size="sm" onClick={onDismiss} />
        </span>
      )} />
      <div className="ov-group">
        {digest.groups.map((g) => <GroupList key={g.outcome} brief={brief} group={g} items={items} />)}
        {waiting > 0 && <Button variant="quiet" size="sm" className="ov-more" onClick={() => document.getElementById('reply-queue')?.scrollIntoView({ block: 'start' })}>{waiting} waiting</Button>}
      </div>
    </section>
  );
}
