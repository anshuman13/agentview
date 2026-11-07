export type BadgeSpec = {
  status: 'waiting' | 'sent' | 'skipped' | 'failed' | 'done' | 'late' | 'new' | 'running';
  label?: 'Needs you' | 'Live';
  reason?: string;
};

export function Badge({ status, label, reason, count }: BadgeSpec & { count?: number }) {
  const word = (status === 'waiting' && label === 'Needs you') || (status === 'running' && label === 'Live') ? label : status[0].toUpperCase() + status.slice(1);
  return <span className={`badge ${status}`} aria-label={reason} title={reason}>{count != null ? `${count} ${word.toLowerCase()}` : word}</span>;
}
