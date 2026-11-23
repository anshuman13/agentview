import { useState, type ReactNode } from 'react';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { readBox, saveBox } from './boxOpen';

export const LinkAction = ({ label, title, onClick }: { label: string; title?: string; onClick: () => void }) => <Button variant="plain" size="sm" className="tr-link" title={title} onClick={onClick}>{label}</Button>;

// The Report card header: icon, headline title, a link action on the right, over a hairline when the body is open.
// With onOpen the card has no body to fold: the header opens the thing instead.
export function TranscriptBox({ id, title, meta, state, icon, action, menu, onOpen, summary, defaultOpen = false, open: controlled, onToggle, className, children }: {
  id: string;
  title: ReactNode;
  meta?: ReactNode;
  state?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  menu?: ReactNode;
  onOpen?: () => void;
  summary?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  className?: string;
  children?: ReactNode;
}) {
  const [saved, setSaved] = useState(() => readBox(id, defaultOpen));
  const open = controlled ?? saved;
  const toggle = onOpen ?? (() => {
    if (controlled === undefined) {
      saveBox(id, !open);
      setSaved(!open);
    }
    onToggle?.(!open);
  });
  const chevron = <Icon name={open ? 'chevron-down' : 'chevron-right'} small />;
  return (
    <div className={`tr-box tr-act${open ? ' tr-open' : ''}${className ? ` ${className}` : ''}`}>
      <Row leading={icon ?? chevron} trailing={icon && !onOpen ? chevron : undefined} title={title} meta={meta} state={state} action={action} menu={menu} aria-expanded={onOpen ? undefined : open} onClick={toggle} />
      {summary && <div className="tr-box-summary">{summary}</div>}
      {open && children}
    </div>
  );
}
