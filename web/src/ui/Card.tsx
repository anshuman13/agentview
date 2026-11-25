import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cx } from './util';

// Hairline preview card (Travel trips, Sketches): cover on top, title and caption below.
export function Card({ cover, title, meta, selected, children, className, ...rest }: Omit<ComponentPropsWithoutRef<'button'>, 'title'> & {
  cover?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  selected?: boolean;
}) {
  return (
    <button type="button" className={cx('ui-card', selected && 'selected', className)} aria-pressed={selected} {...rest}>
      {cover && <span className="ui-card-cover">{cover}</span>}
      <span className="ui-card-body">
        <span className="ui-card-title" title={typeof title === 'string' ? title : undefined}>{title}</span>
        {meta && <span className="ui-card-meta">{meta}</span>}
        {children}
      </span>
    </button>
  );
}

export function CardGrid({ className, ...rest }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cx('ui-card-grid', className)} {...rest} />;
}
