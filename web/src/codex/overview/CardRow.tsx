import { useRef, useState, type ReactNode } from 'react';
import { Button, IconButton } from '../../ui/Button';
import { Menu } from '../../ui/Menu';
import { AskRow } from '../../ui/AskRow';
import { Badge, type BadgeSpec } from '../../ui/Badge';

// One overview row: the whole row opens the thing, the badge sits in the row, and one icon action plus a More menu sit beside it.
// A second click of a double tap on the button or action is ignored.
export function CardRow({ title, meta, leading, badge, onOpen, button, action, menu }: {
  title: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  badge?: BadgeSpec;
  onOpen: () => void;
  button?: { label: string; run: () => void };
  action?: { icon: string; label: string; run: () => void };
  menu?: (choose: (fn: () => void) => () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const choose = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <AskRow leading={leading} title={title} meta={meta} onClick={onOpen} onLongPress={menu ? () => setOpen(true) : undefined}
      trailing={badge && <Badge {...badge} />}
      actions={(button || action || menu) && (
        <>
          {button && <Button size="sm" variant="tinted" onClick={(e) => { if (e.detail < 2) button.run(); }}>{button.label}</Button>}
          {action && <IconButton size="sm" icon={action.icon} label={action.label} onClick={(e) => { if (e.detail < 2) action.run(); }} />}
          {menu && (
            <span className="ov-more">
              <IconButton ref={more} size="sm" icon="kebab-horizontal" label="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} />
              {open && <Menu trigger={more} onClose={() => setOpen(false)}>{menu(choose)}</Menu>}
            </span>
          )}
        </>
      )} />
  );
}
