import type { ComponentPropsWithoutRef, ReactNode } from 'react';

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

export function Row({ leading, title, meta, trailing, lines = 1, href, plain, action, className, ...rest }: Omit<ComponentPropsWithoutRef<'button'>, 'title' | 'children'> & {
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  lines?: 1 | 2;
} & ({ href?: undefined; plain?: false; action?: ReactNode } | { href?: string; plain?: boolean; action?: never })) {
  const cls = cx('ui-row', !!leading && 'has-lead', className);
  const body = (
    <>
      {leading && <span className="ui-row-lead">{leading}</span>}
      <span className="ui-row-body">
        <span className={cx('ui-row-title', lines === 2 && 'two')}>{title}</span>
        {meta && <span className="ui-row-meta">{meta}</span>}
      </span>
      {trailing && <span className="ui-row-trail">{trailing}</span>}
    </>
  );
  if (plain) return <div className={cls} {...(rest as ComponentPropsWithoutRef<'div'>)}>{body}</div>;
  if (href) return <a className={cls} href={href} target="_blank" rel="noreferrer" onMouseDown={rest.onMouseDown as React.MouseEventHandler<HTMLAnchorElement> | undefined}>{body}</a>;
  const button = <button type="button" className={cls} {...rest}>{body}</button>;
  return action ? <div className="ui-row-wrap">{button}{action}</div> : button;
}
