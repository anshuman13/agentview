import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Icon } from './Icon';
import { cx } from './util';


export function Panel({ title, action, padding = 'md', className, children, ...rest }: {
  title?: ReactNode;
  action?: ReactNode;
  padding?: 'sm' | 'md';
} & ComponentPropsWithRef<'section'>) {
  return (
    <section className={cx('ui-panel', `ui-panel-${padding}`, className)} {...rest}>
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

// A pill search box above a list; Escape clears it.
export function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="page-search">
      <Icon name="search" small />
      <input type="search" enterKeyHint="search" value={value} placeholder={label} aria-label={label} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onChange('')} />
    </label>
  );
}
