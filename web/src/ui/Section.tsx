import type { ReactNode } from 'react';
import { Icon } from './Icon';

export function Section({ label, count, action, open, onToggle }: {
  label: ReactNode;
  count?: number;
  action?: ReactNode;
  open?: boolean;
  onToggle?: () => void;
}) {
  const head = (
    <>
      {onToggle && <Icon name="chevron-right" small />}
      <span className="ui-section-label">{label}</span>
      {count != null && <span className="badge quiet">{count}</span>}
    </>
  );
  return (
    <div className="ui-section">
      {onToggle ? <button type="button" className="ui-section-head" aria-expanded={open} onClick={onToggle}>{head}</button> : <div className="ui-section-head">{head}</div>}
      {action}
    </div>
  );
}
