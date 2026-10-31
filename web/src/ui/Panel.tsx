import type { ReactNode } from 'react';
import { Icon } from './Icon';

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

export function Panel({ title, action, padding = 'md', className, children }: {
  title?: ReactNode;
  action?: ReactNode;
  padding?: 'sm' | 'md';
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section className={cx('ui-panel', `ui-panel-${padding}`, className)}>
      {(title || action) && (
        <header className="ui-panel-head">
          {title && <h3 className="ui-panel-title">{title}</h3>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ icon, title, hint, action, size = 'md' }: {
  icon?: string;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={cx('ui-empty', `ui-empty-${size}`)}>
      {icon && <span className="ui-empty-icon"><Icon name={icon} /></span>}
      <div className="ui-empty-title">{title}</div>
      {hint && <div className="ui-empty-hint">{hint}</div>}
      {action}
    </div>
  );
}
