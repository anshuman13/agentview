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

export type BriefReport = { key: string; at: number; brief: Brief; first: string; parsed?: NonNullable<ReturnType<typeof parseBrief>>; digest?: NonNullable<ReturnType<typeof parseDigest>> };

// Today's morning brief from the hub, one per profile, and the day and away digests the hub writes at 17:00, shown for a day from the hub's midnight in any time zone. The cross on a card hides that report until tomorrow.
export function useBriefs(now: number) {
  const all = useAssistantTable('briefs');
  const { filter } = useView();
  const [dismissed, setDismissed] = useState<string[]>(() => stored<string[]>(DISMISSED, []));
  const briefs = all.filter((b) => !b.deleted && (b.kind === 'morning' || b.kind === 'day' || b.kind === 'away') && b.from_at != null && now >= b.from_at && now - b.from_at < DAY && b.text && (filter === 'all' || b.profile === filter) && !dismissed.includes(rowKey(b)) && !dismissed.includes(b.profile + b.id))
    .sort((a, b) => Number(b.profile === 'work') - Number(a.profile === 'work'));
  const dismiss = (key: string) => {
    const next = [...dismissed.filter((k) => k !== key), key].slice(-MAX_DISMISSED);
    setDismissed(next);
    save(DISMISSED, next);
  };
  const reports = briefs.flatMap((b): BriefReport[] => {
    const at = b.from_at!, key = rowKey(b);
    if (b.kind === 'morning') {
      const parsed = parseBrief(b.rows);
      return parsed ? [{ key, at, brief: b, parsed, first: parsed.groups[0]?.rows[0]?.title ?? '' }] : [];
    }
    const digest = parseDigest(b.kind as 'day' | 'away', b.rows);
    return digest ? [{ key, at, brief: b, digest, first: digest.groups[0]?.rows[0]?.chat ?? '' }] : [];
  });
  return { reports, dismiss };
}

export function BriefReportCard({ report, showProfile, onDismiss }: { report: BriefReport; showProfile: boolean; onDismiss: () => void }) {
  const props = { brief: report.brief, showProfile, onDismiss };
  return report.parsed ? <BriefCard {...props} parsed={report.parsed} /> : <DigestCard {...props} digest={report.digest!} />;
}
