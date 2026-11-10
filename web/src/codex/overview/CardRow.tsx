import type { ReactNode } from 'react';
import { Button, IconButton } from '../../ui/Button';
import { Row } from '../../ui/Row';
import { Badge, type BadgeSpec } from '../../ui/Badge';

// One overview row: the whole row opens the thing, the badge sits in the state slot (null keeps the slot empty, so rows line up), and one action plus the More menu sit after it.
// A second click of a double tap on the button or action is ignored.
export function CardRow({ title, meta, leading, badge, onOpen, button, action, menu }: {
  title: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  badge?: BadgeSpec | null;
  onOpen: () => void;
  button?: { label: string; run: () => void };
  action?: { icon: string; label: string; run: () => void };
  menu?: ReactNode;
}) {
  return (
    <div className="ov-ask">
      <Row leading={leading} title={title} meta={meta} state={badge === undefined ? undefined : badge && <Badge {...badge} />} onClick={onOpen} menu={menu}
        action={(button || action) && (
          <>
            {button && <Button size="sm" variant="tinted" onClick={(e) => { if (e.detail < 2) button.run(); }}>{button.label}</Button>}
            {action && <IconButton size="sm" icon={action.icon} label={action.label} onClick={(e) => { if (e.detail < 2) action.run(); }} />}
          </>
        )} />
    </div>
  );
}
