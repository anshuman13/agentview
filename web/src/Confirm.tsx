import { useEffect, useRef } from 'react';
import { Icon } from './Icon';

export type ConfirmRequest = { title: string; detail: string; warning?: string; action: string; run: () => Promise<unknown> };

export function Confirm({ title, detail, warning, action, run, onClose }: ConfirmRequest & { onClose: () => void }) {
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => ok.current?.focus(), []);
  const go = () => {
    void run();
    onClose();
  };

  return (
    <div className="overlay dialog-overlay" onClick={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="dialog" role="alertdialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <span className="dialog-icon"><Icon name="warning" /></span>
        <div className="dialog-body">
          <div className="dialog-title">{title}</div>
          <div className="dialog-detail">{detail}</div>
          {warning && <div className="dialog-warning">{warning}</div>}
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
          <button ref={ok} className="destructive" onClick={go}>{action}</button>
        </div>
      </div>
    </div>
  );
}
