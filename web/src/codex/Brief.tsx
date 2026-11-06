import { useState } from 'react';
import { useAssistantTable } from './data';
import { save, stored } from '../ui/util';
import { useView } from './view';
import { rowKey } from './data/sync';
import type { Brief } from './data/wiki';
import { BriefCard } from './overview/BriefCard';
import { DigestCard } from './overview/DigestCard';
import { parseBrief, parseDigest } from './overview/digest';

const DISMISSED = 'codex.briefDismissed';
const DAY = 86400000;
const MAX_DISMISSED = 50;

// Today's morning brief from the hub, one per profile, and the day and away digests the hub writes at 17:00, shown for a day from the hub's midnight in any time zone. The morning brief and each digest are report cards. The cross hides one card until tomorrow.
export function MorningBrief({ now }: { now: number }) {
  const all = useAssistantTable('briefs');
  const { filter } = useView();
  const [dismissed, setDismissed] = useState<string[]>(() => stored<string[]>(DISMISSED, []));
  const briefs = all.filter((b) => !b.deleted && (b.kind === 'morning' || b.kind === 'day' || b.kind === 'away') && b.from_at != null && now >= b.from_at && now - b.from_at < DAY && b.text && (filter === 'all' || b.profile === filter) && !dismissed.includes(rowKey(b)) && !dismissed.includes(b.profile + b.id))
    .sort((a, b) => Number(b.profile === 'work') - Number(a.profile === 'work'));
  const dismiss = (b: Brief) => {
    const next = [...dismissed.filter((k) => k !== rowKey(b)), rowKey(b)].slice(-MAX_DISMISSED);
    setDismissed(next);
    save(DISMISSED, next);
  };
  const cards = briefs.map((b) => {
    const props = { brief: b, showProfile: filter === 'all', onDismiss: () => dismiss(b) };
    if (b.kind === 'morning') {
      const parsed = parseBrief(b.rows);
      return parsed && <BriefCard key={rowKey(b)} {...props} parsed={parsed} />;
    }
    const digest = parseDigest(b.kind as 'day' | 'away', b.rows);
    return digest && <DigestCard key={rowKey(b)} {...props} digest={digest} />;
  }).filter(Boolean);
  return cards.length ? cards : null;
}
