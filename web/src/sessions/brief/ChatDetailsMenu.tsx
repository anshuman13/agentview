import { useRef, useState } from 'react';
import { IconButton } from '../../ui/Button';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { command } from '../../ui/util';

type Props = {
  hasAgents: boolean;
  showAgents: boolean;
  agentsRunning: number;
  agentsDone: number;
  waitingElsewhere: number;
  usage: { label: string; onClick: () => void } | null | undefined;
  macName: string | null | undefined;
  extras: string;
  hasActions: boolean;
  openAgents: () => void;
};

export function ChatDetailsMenu({ hasAgents, showAgents, agentsRunning, agentsDone, waitingElsewhere, usage, macName, extras, hasActions, openAgents }: Props) {
  const [more, setMore] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const choose = (fn: () => void) => () => { setMore(false); fn(); };
  return (
    <span className="tl-more">
      <IconButton ref={moreBtn} size="sm" icon="kebab-horizontal" label="Chat details" aria-haspopup="menu" aria-expanded={more} onClick={() => setMore(!more)} />
      {more && (
        <Menu trigger={moreBtn} onClose={() => setMore(false)}>
          {(hasAgents || showAgents) && (
            <MenuItem icon={agentsRunning ? 'loading' : 'hubot'} spin={agentsRunning > 0} onClick={choose(openAgents)}>
              {showAgents ? 'Agents' : `Agents · ${[agentsRunning && `${agentsRunning} running`, agentsDone && `${agentsDone} done`].filter(Boolean).join(', ')}`}
            </MenuItem>
          )}
          {waitingElsewhere > 0 && <MenuItem icon="inbox" onClick={choose(() => command('view:chats'))}>{waitingElsewhere} waiting</MenuItem>}
          {usage && <MenuItem icon="pulse" onClick={choose(usage.onClick)}>Usage {usage.label}</MenuItem>}
          {(macName || extras) && hasActions && <MenuSeparator />}
          {macName && <MenuItem icon="vm" disabled>{macName}</MenuItem>}
          {extras && <MenuItem disabled>{extras}</MenuItem>}
        </Menu>
      )}
    </span>
  );
}
