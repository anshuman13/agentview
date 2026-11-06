import { useRef, useState, type ReactNode } from 'react';
import { Button, IconButton } from '../../ui/Button';
import { Menu } from '../../ui/Menu';

// One overview row: the whole row opens the thing, the badge sits in the row, and one icon action plus a More menu sit beside it.
// A second click of a double tap on the button or action is ignored.
export function CardRow({ title, meta, leading, badge, onOpen, button, action, menu }: {
  title: ReactNode;
  meta: ReactNode;
  leading?: ReactNode;
  badge?: { label: string; tone: 'waiting' | 'quiet' };
  onOpen: () => void;
  button?: { label: string; run: () => void };
  action?: { icon: string; label: string; run: () => void };
  menu?: (choose: (fn: () => void) => () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const choose = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div className="ov-ask">
      <div className="ov-ask-line">
        <button type="button" className={`ui-row${leading ? ' has-lead' : ''}`} onClick={onOpen}>
          {leading && <span className="ui-row-lead">{leading}</span>}
          <span className="ui-row-body">
            <span className="ui-row-title">{title}</span>
            <span className="ui-row-meta">{meta}</span>
          </span>
          {badge && <span className="ui-row-trail"><span className={`badge ${badge.tone}`}>{badge.label}</span></span>}
        </button>
        {(button || action || menu) && (
          <span className="ov-ask-actions">
            {button && <Button size="sm" variant="tinted" onClick={(e) => { if (e.detail < 2) button.run(); }}>{button.label}</Button>}
            {action && <IconButton size="sm" icon={action.icon} label={action.label} onClick={(e) => { if (e.detail < 2) action.run(); }} />}
            {menu && (
              <span className="ov-more">
                <IconButton ref={more} size="sm" icon="kebab-horizontal" label="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} />
                {open && <Menu trigger={more} onClose={() => setOpen(false)}>{menu(choose)}</Menu>}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
