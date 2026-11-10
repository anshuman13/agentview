import type { ReactNode } from 'react';
import { Icon } from './Icon';

export const sectionCount = (n: number) => n || undefined;

export function Section({ label, count, action, open, onToggle }: {
  label: ReactNode;
  count?: number | string | string[];
  action?: ReactNode;
  open?: boolean;
  onToggle?: () => void;
}) {
  const head = (
    <>
      {onToggle && <Icon name="chevron-right" small />}
      <span className="ui-section-label">{label}</span>
      {count != null && [count].flat().map((c) => <span key={c} className="badge quiet">{c}</span>)}
    </>
  );
  return (
    <div className="ui-section">
      {onToggle ? <button type="button" className="ui-section-head" aria-expanded={open} onClick={onToggle}>{head}</button> : <div className="ui-section-head">{head}</div>}
      {action && <span className="ui-section-actions">{action}</span>}
    </div>
  );
}
