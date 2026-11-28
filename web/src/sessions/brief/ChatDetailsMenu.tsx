import { useRef, useState } from 'react';
import { IconButton } from '../../ui/Button';
import { Menu, MenuItem } from '../../ui/Menu';
import { forkChat, setOutputStyle } from '../../chat/chatActions';
import { useStore } from '../../app/store';
import { OUTPUT_STYLES, outputStyleLabel, outputStyleValue, reviewLabel } from '../../../../shared/chatMenu';

type Props = {
  icon?: string;
  running: boolean;
  hasChanges: boolean;
  review: () => void;
  rename?: () => void;
};

export function ChatDetailsMenu({ icon = 'kebab-horizontal', running, hasChanges, review, rename }: Props) {
  const [more, setMore] = useState(false);
  const [styles, setStyles] = useState(false);
  const provider = useStore((s) => s.session.provider);
  const style = outputStyleLabel(useStore((s) => s.session.outputStyle));
  const moreBtn = useRef<HTMLButtonElement>(null);
  const reviewOff = running || !hasChanges;
  const choose = (fn: () => void) => () => { setMore(false); fn(); };
  return (
    <span className="tl-more">
      <IconButton ref={moreBtn} size="sm" icon={icon} label="Chat details" aria-haspopup="menu" aria-expanded={more} onClick={() => { setMore(!more); setStyles(false); }} />
      {more && (
        <Menu trigger={moreBtn} onClose={() => setMore(false)}>
          <MenuItem icon="edit" disabled={!rename} shortcut="R" onClick={rename && choose(rename)}>Rename</MenuItem>
          <MenuItem icon="repo-forked" shortcut="F" onClick={choose(forkChat)}>Fork</MenuItem>
          <MenuItem icon="source-control" disabled={reviewOff} title={reviewOff ? undefined : 'The agent reviews the working tree, findings show in the Changes view'} shortcut="V" onClick={choose(review)}>{reviewLabel(running, hasChanges)}</MenuItem>
          {provider !== 'codex' && <MenuItem icon="comment" aria-expanded={styles} onClick={() => setStyles(!styles)}>Output style · {style}</MenuItem>}
          {styles && OUTPUT_STYLES.map((l) => <MenuItem key={l} role="menuitemradio" icon={l === style ? 'check' : 'blank'} aria-checked={l === style} onClick={choose(() => setOutputStyle(outputStyleValue(l)))}>{l}</MenuItem>)}
        </Menu>
      )}
    </span>
  );
}

