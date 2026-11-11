import { useState, type ReactNode } from 'react';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { readBox, saveBox } from './boxOpen';

export function TranscriptBox({ id, title, meta, state, action, summary, defaultOpen = false, onToggle, className, children }: {
  id: string;
  title: ReactNode;
  meta?: ReactNode;
  state?: ReactNode;
  action?: ReactNode;
  summary?: ReactNode;
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(() => readBox(id, defaultOpen));
  const toggle = () => {
    saveBox(id, !open);
    setOpen(!open);
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
