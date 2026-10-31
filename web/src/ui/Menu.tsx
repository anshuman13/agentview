import { useEffect, useRef, type ComponentPropsWithoutRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Icon } from './Icon';

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');
const FOCUSABLE = 'button:not(:disabled), a[href], select:not(:disabled)';

export function Menu({ trigger, onClose, className, children }: {
  trigger: RefObject<HTMLElement | null>;
  onClose: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    box.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !trigger.current?.contains(t)) close.current();
    };
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close.current();
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [trigger]);
  const move = (e: KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || (e.target as HTMLElement).tagName === 'SELECT') return;
    const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };
  return (
    <div ref={box} role="menu" className={cx('ui-menu', className)} onKeyDown={move}>
      {children}
    </div>
  );
}

type Item = {
  icon?: string;
  spin?: boolean;
  danger?: boolean;
  href?: string;
  children?: ReactNode;
};

export function MenuItem({ icon, spin, danger, href, className, children, ...rest }: Item & Omit<ComponentPropsWithoutRef<'button'>, 'children'>) {
  const content = (
    <>
      {icon && <Icon name={icon} small spin={spin} />}
      {children}
    </>
  );
  const cls = cx('ui-menu-item', danger && 'danger', className);
  if (href) return <a role="menuitem" className={cls} href={href} target="_blank" rel="noreferrer" onClick={rest.onClick as never}>{content}</a>;
  return <button type="button" role="menuitem" className={cls} {...rest}>{content}</button>;
}

export const MenuSeparator = () => <div role="separator" className="ui-menu-sep" />;
