import { useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { IconButton } from './Button';
import { Menu } from './Menu';
import { useLongPress } from './longPress';
import { cx } from './util';


export function Row({ leading, title, meta, state, trailing, menu, lines = 1, href, plain, action, className, onLongPress, ...rest }: Omit<ComponentPropsWithoutRef<'button'>, 'title' | 'children'> & {
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  state?: ReactNode;
  trailing?: ReactNode;
  lines?: 1 | 2;
  onLongPress?: () => void;
} & ({ href?: undefined; plain?: boolean; action?: ReactNode; menu?: ReactNode } | { href?: string; plain?: boolean; action?: never; menu?: never })) {
  const [open, setOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const press = useLongPress(onLongPress ?? (menu ? () => setOpen(true) : undefined));
  const cls = cx('ui-row', !!leading && 'has-lead', className);
  const handlers = (!href && press) ? {
    ref: (el: HTMLElement | null) => el?.setAttribute('data-long-press', ''),
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => { rest.onPointerDown?.(e as never); press.down(e); },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => { rest.onPointerMove?.(e as never); press.move(e); },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => { rest.onPointerUp?.(e as never); press.up(e); },
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => { rest.onPointerCancel?.(e as never); press.cancel(); },
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => { rest.onContextMenu?.(e as never); press.menu(e.nativeEvent); },
  } : undefined;
  const body = (
    <>
      {leading && <span className="ui-row-lead">{leading}</span>}
      <span className="ui-row-body">
        <span className={cx('ui-row-title', lines === 2 && 'two')} title={typeof title === 'string' ? title : undefined}>{title}</span>
        {meta && <span className="ui-row-meta" title={typeof meta === 'string' ? meta : undefined}>{meta}</span>}
      </span>
      {state !== undefined && <span className="ui-row-state">{state}</span>}
      {trailing && <span className="ui-row-trail">{trailing}</span>}
    </>
  );
  if (href && !plain) return <a className={cls} href={href} target="_blank" rel="noreferrer" onMouseDown={rest.onMouseDown as React.MouseEventHandler<HTMLAnchorElement> | undefined}>{body}</a>;
  const button = plain
    ? <div className={cls} {...(rest as ComponentPropsWithoutRef<'div'>)} {...handlers}>{body}</div>
    : <button type="button" className={cls} {...rest} {...handlers}>{body}</button>;
  const kebab = menu && (
    <>
      <IconButton ref={more} icon="kebab-vertical" label="More" size="sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} />
      {open && <div className="ui-row-menu" onClick={() => setOpen(false)}><Menu trigger={more} onClose={() => setOpen(false)}>{menu}</Menu></div>}
    </>
  );
  return action || kebab ? <div className="ui-row-wrap">{button}{action}{kebab}</div> : button;
}
