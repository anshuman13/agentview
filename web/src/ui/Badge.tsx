export type BadgeSpec = {
  status: 'waiting' | 'sent' | 'skipped' | 'failed' | 'done' | 'late' | 'new' | 'running';
  label?: 'Needs you' | 'Near cap' | 'Live' | 'Connected' | 'Conflicts' | 'In wiki' | 'Stale';
  reason?: string;
};

// The status each label may replace the word on.
const LABEL_ON: Record<NonNullable<BadgeSpec['label']>, BadgeSpec['status']> = { 'Needs you': 'waiting', 'Near cap': 'waiting', Live: 'running', Connected: 'done', Conflicts: 'waiting', 'In wiki': 'skipped', Stale: 'skipped' };

export function Badge({ status, label, reason, count }: BadgeSpec & { count?: number }) {
  const word = label && LABEL_ON[label] === status ? label : status[0].toUpperCase() + status.slice(1);
  return <span className={`badge ${status}`} aria-label={reason} title={reason}>{count != null ? `${count} ${word.toLowerCase()}` : word}</span>;
}
