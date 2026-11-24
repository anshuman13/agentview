import type { ReactNode } from 'react';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { FILTER_LABEL, useView } from './view';

type Props = { title: string; greeting?: boolean; onMenu: () => void; search?: ReactNode; action?: ReactNode; menu?: ReactNode };

export function CodexHead({ title, greeting, onMenu, search, action, menu }: Props) {
  const { filter } = useView();
  return (
    <header className="codex-head">
      <IconButton icon="menu" label="Lists" className="as-menu" onClick={onMenu} />
      <span role="heading" aria-level={1} className={greeting ? 'as-greeting' : undefined}>{greeting && <Icon name="sparkle" />}{title}</span>
      {filter !== 'all' && <span className="muted">{FILTER_LABEL[filter]}</span>}
      <div className="codex-head-end">{search}{action}{menu}</div>
    </header>
  );
}
