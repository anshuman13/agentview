import { useState, type ReactNode } from 'react';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { readBox, saveBox } from './boxOpen';

export function TranscriptBox({ id, title, meta, state, action, summary, defaultOpen = false, open: controlled, onToggle, className, children }: {
  id: string;
  title: ReactNode;
  meta?: ReactNode;
  state?: ReactNode;
  action?: ReactNode;
  summary?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  className?: string;
  children?: ReactNode;
}) {
  const [saved, setSaved] = useState(() => readBox(id, defaultOpen));
  const open = controlled ?? saved;
  const toggle = () => {
    if (controlled === undefined) {
      saveBox(id, !open);
      setSaved(!open);
    }
    onToggle?.(!open);
  };
  return (
    <div className={`tr-box tr-act${className ? ` ${className}` : ''}`}>
      <Row leading={<Icon name={open ? 'chevron-down' : 'chevron-right'} small />} title={title} meta={meta} state={state} action={action} aria-expanded={open} onClick={toggle} />
      {summary && <div className="tr-box-summary">{summary}</div>}
      {open && children}
    </div>
  );
}
