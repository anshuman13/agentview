import { Icon } from './Icon';

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-list" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ animationDelay: `${i * 80}ms` }} />)}
    </div>
  );
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="ui-loading" role="status" aria-busy="true">
      <Icon name="loading" spin />
      <span>{text}</span>
    </div>
  );
}
