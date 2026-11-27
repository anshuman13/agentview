import { useRef, useState } from 'react';
import { IconButton } from '../../ui/Button';
import { Menu, MenuItem } from '../../ui/Menu';
import { reviewLabel } from '../../../../shared/chatMenu';

type Props = {
  icon?: string;
  running: boolean;
  hasChanges: boolean;
  review: () => void;
  rename?: () => void;
};

export function ChatDetailsMenu({ icon = 'kebab-horizontal', running, hasChanges, review, rename }: Props) {
  const [more, setMore] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const reviewOff = running || !hasChanges;
  const choose = (fn: () => void) => () => { setMore(false); fn(); };
  return (
    <span className="tl-more">
      <IconButton ref={moreBtn} size="sm" icon={icon} label="Chat details" aria-haspopup="menu" aria-expanded={more} onClick={() => setMore(!more)} />
      {more && (
        <Menu trigger={moreBtn} onClose={() => setMore(false)}>
          <MenuItem icon="edit" disabled={!rename} onClick={rename && choose(rename)}>Rename</MenuItem>
          <MenuItem icon="source-control" disabled={reviewOff} title={reviewOff ? undefined : 'The agent reviews the working tree, findings show in the Changes view'} onClick={choose(review)}>{reviewLabel(running, hasChanges)}</MenuItem>
        </Menu>
      )}
    </span>
  );
}

