import { Children, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ComponentPropsWithoutRef, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { cx } from './util';
import { leaveCopy } from './sheetLeave';

const FOCUSABLE = 'button:not(:disabled), a[href], select:not(:disabled)';
export const PHONE ='(max-width: 480px)';

const subscribePhone = (cb: () => void) => {
  const mq = matchMedia(PHONE);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const usePhone = () => useSyncExternalStore(subscribePhone, () => matchMedia(PHONE).matches, () => false);

const TYPE_RESET = 700;

export function typeAhead(labels: string[], from: number, buffer: string): number {
  const lower = buffer.toLowerCase();
  const cycle = [...lower].every(c => c === lower[0]);
  const text = cycle ? lower.slice(0, 1) : lower;
  const start = cycle ? from + 1 : Math.max(from, 0);
  for (let i = 0; i < labels.length; i++) {
    const at = (start + i) % labels.length;
    if (labels[at].trim().toLowerCase().startsWith(text)) return at;
  }
  return -1;
}

// The item whose letter key matches, like Claude.app's title dropdown; letter keys win over type-ahead.
export function letterItem(keys: (string | null | undefined)[], key: string): number {
  const k = key.toLowerCase();
  return keys.findIndex(x => !!x && x.toLowerCase() === k);
}

const menuClass = (phone: boolean, className?: string) => cx('ui-menu', phone && 'sheet', className);

export function Menu({ trigger, onClose, className, children }: {
  trigger: RefObject<HTMLElement | null>;
  onClose: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const phone = usePhone();
  const box = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => () => { if (backdrop.current) leaveCopy([backdrop.current, box.current]); }, []);
  const close = useRef(onClose);
  close.current = onClose;
  const typed = useRef({ text: '', timer: 0 });
  useEffect(() => {
    box.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || trigger.current?.contains(t)) return;
      close.current();
      if (!(t as Element).classList?.contains('ui-menu-backdrop')) return;
      const swallow = (ev: MouseEvent) => {
        clearTimeout(timer);
        document.removeEventListener('click', swallow, true);
        if (!trigger.current?.contains(ev.target as Node)) return;
        ev.stopPropagation();
        ev.preventDefault();
      };
      const timer = setTimeout(() => document.removeEventListener('click', swallow, true), 400);
      document.addEventListener('click', swallow, true);
    };
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close.current();
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    const pending = typed.current;
    return () => {
      clearTimeout(pending.timer);
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [trigger]);
  const type = (e: KeyboardEvent) => {
    const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const hit = letterItem(items.map(i => i.dataset.key), e.key);
    if (hit >= 0) return items[hit].click();
    const pending = typed.current;
    clearTimeout(pending.timer);
    pending.text += e.key;
    pending.timer = window.setTimeout(() => { pending.text = ''; }, TYPE_RESET);
    const next = typeAhead(items.map(i => i.textContent ?? ''), items.indexOf(document.activeElement as HTMLElement), pending.text);
    if (next >= 0) items[next].focus();
  };
  const move = (e: KeyboardEvent) => {
    // Fields inside a menu keep their own keys.
    if (['SELECT', 'INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
    if (e.key.length === 1 && e.key !== ' ' && !e.nativeEvent.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey) return type(e);
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };
  // An item that closes the menu leaves focus on its opener, so a sheet or dialog it opens returns focus there.
  const pick = (e: ReactMouseEvent) => {
    const item = (e.target as Element).closest<HTMLElement>('[role=menuitem]');
    if (!item) return;
    trigger.current?.focus();
    setTimeout(() => { if (item.isConnected) item.focus(); });
  };
  if (Children.toArray(children).length === 0) return null;
  const menu = (
    <div ref={box} role="menu" className={menuClass(phone, className)} onKeyDown={move} onClickCapture={pick}>
      {children}
    </div>
  );
  if (!phone) return menu;
  return createPortal(<><div ref={backdrop} className="ui-menu-backdrop" />{menu}</>, document.body);
}

type Item = {
  icon?: string;
  spin?: boolean;
  danger?: boolean;
  href?: string;
  shortcut?: string;
  children?: ReactNode;
};

export function MenuItem({ icon, spin, danger, href, shortcut, className, children, ...rest }: Item & Omit<ComponentPropsWithoutRef<'button'>, 'children'>) {
  const content = (
    <>
      {icon && <Icon name={icon} small spin={spin} />}
      {children}
      {shortcut && <kbd className="ui-menu-key">{shortcut}</kbd>}
    </>
  );
  const cls = cx('ui-menu-item', danger && 'danger', className);
  if (href) return <a role="menuitem" className={cls} href={href} target="_blank" rel="noreferrer" onClick={rest.onClick as never}>{content}</a>;
  return <button type="button" role="menuitem" className={cls} data-key={shortcut} {...rest}>{content}</button>;
}

export const MenuSeparator = () => <div role="separator" className="ui-menu-sep" />;
