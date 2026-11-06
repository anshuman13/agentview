import { useRef, useState, type ReactNode } from 'react';
import { IconButton } from '../../ui/Button';
import { Menu } from '../../ui/Menu';

// One overview row: the whole row opens the thing, the badge sits in the row, and one icon action plus a More menu sit beside it.
// A second click of a double tap on the action is ignored.
export function CardRow({ title, meta, badge, onOpen, action, menu }: {
  title: ReactNode;
  meta: ReactNode;
  badge?: { label: string; tone: 'waiting' | 'quiet' };
  onOpen: () => void;
  action?: { icon: string; label: string; run: () => void };
  menu?: (choose: (fn: () => void) => () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const choose = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div className="ov-ask">
      <div className="ov-ask-line">
        <button type="button" className="ui-row" onClick={onOpen}>
          <span className="ui-row-body">
            <span className="ui-row-title">{title}</span>
            <span className="ui-row-meta">{meta}</span>
          </span>
          {badge && <span className="ui-row-trail"><span className={`badge ${badge.tone}`}>{badge.label}</span></span>}
        </button>
        {(action || menu) && (
          <span className="ov-ask-actions">
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
