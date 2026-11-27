import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { useReturnFocus } from './util';

export type ConfirmRequest = {
  title: string;
  detail: string;
  body?: ReactNode;
  warning?: string;
  action: string;
  icon?: string;
  cancel?: string;
  neutral?: boolean;
  input?: { value: string; placeholder: string; maxLength?: number };
  extra?: { label: string; run: () => Promise<unknown> };
  run: (value: string) => Promise<unknown>;
};

export function Confirm({ title, detail, body, warning, action, icon, cancel, neutral, input, extra, run, onClose: done }: ConfirmRequest & { onClose: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const onClose = () => {
    if (leaving) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
    else setLeaving(true);
  };
  const ok = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(input?.value ?? '');
  useReturnFocus();
  useEffect(() => (input ? field.current?.focus() : ok.current?.focus()), []);
  const go = () => {
    if (leaving || (input && !value.trim())) return;
    void run(value.trim());
    onClose();
  };

  return (
    <div
      className={`overlay dialog-overlay ${leaving ? 'leaving' : ''}`}
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      onAnimationEnd={(e) => leaving && e.target === e.currentTarget && done()}
    >
      <div className="dialog" role="alertdialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <span className={`dialog-icon ${input || neutral ? 'neutral' : ''}`}><Icon name={icon ?? 'warning'} /></span>
        <div className="dialog-body">
          <div className="dialog-title">{title}</div>
          <div className="dialog-detail">{detail}</div>
          {body}
          {input && (
            <input
              ref={field}
              className="dialog-input"
              value={value}
              placeholder={input.placeholder}
              maxLength={input.maxLength}
              spellCheck={false}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && go()}
            />
          )}
          {warning && <div className="dialog-warning">{warning}</div>}
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>{cancel ?? 'Cancel'}</button>
          {extra && <button onClick={() => { if (leaving) return; void extra.run(); onClose(); }}>{extra.label}</button>}
          <button ref={ok} className={input || neutral ? 'primary' : 'destructive'} disabled={Boolean(input && !value.trim())} onClick={go}>{action}</button>
        </div>
      </div>
    </div>
  );
}
