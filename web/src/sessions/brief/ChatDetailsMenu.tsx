import { useRef, useState } from 'react';
import { IconButton } from '../../ui/Button';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { reviewLabel, usageMenuLabel } from '../../../../shared/chatMenu';
import { command } from '../../ui/util';

type Props = {
  showWork: boolean;
  toggleWork: () => void;
  hasAgents: boolean;
  showAgents: boolean;
  agentsRunning: number;
  agentsDone: number;
  waitingElsewhere: number;
  usage: { account: string | null; week: number | null; fiveHour: number | null; onClick: () => void } | null | undefined;
  macName: string | null | undefined;
  extras: string;
  openAgents: () => void;
  running: boolean;
  hasChanges: boolean;
  review: () => void;
};

export function ChatDetailsMenu({ showWork, toggleWork, hasAgents, showAgents, agentsRunning, agentsDone, waitingElsewhere, usage, macName, extras, openAgents, running, hasChanges, review }: Props) {
  const [more, setMore] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const reviewOff = running || !hasChanges;
  const usageLabel = usage && usageMenuLabel(usage.account, usage.week, usage.fiveHour);
  const choose = (fn: () => void) => () => { setMore(false); fn(); };
  return (
    <span className="tl-more">
      <IconButton ref={moreBtn} size="sm" icon="kebab-horizontal" label="Chat details" aria-haspopup="menu" aria-expanded={more} onClick={() => setMore(!more)} />
      {more && (
        <Menu trigger={moreBtn} onClose={() => setMore(false)}>
          <MenuItem icon={showWork ? 'check' : undefined} role="menuitemcheckbox" aria-checked={showWork} onClick={choose(toggleWork)}>Show work</MenuItem>
          <MenuItem icon="source-control" disabled={reviewOff} title={reviewOff ? undefined : 'The agent reviews the working tree, findings show in the Changes view'} onClick={choose(review)}>{reviewLabel(running, hasChanges)}</MenuItem>
          {(hasAgents || showAgents) && (
            <MenuItem icon={agentsRunning ? 'loading' : 'hubot'} spin={agentsRunning > 0} onClick={choose(openAgents)}>
              {showAgents ? 'Back to chat' : `Agents · ${[agentsRunning && `${agentsRunning} running`, agentsDone && `${agentsDone} done`].filter(Boolean).join(', ')}`}
            </MenuItem>
          )}
          {waitingElsewhere > 0 && <MenuItem icon="inbox" onClick={choose(() => command('view:chats'))}>{waitingElsewhere} waiting</MenuItem>}
          {usage && usageLabel && <MenuItem icon="pulse" onClick={choose(usage.onClick)}>{usageLabel}</MenuItem>}
          {(macName || extras) && <MenuSeparator />}
          {macName && <MenuItem icon="vm" disabled>{macName}</MenuItem>}
          {extras && <MenuItem disabled>{extras}</MenuItem>}
        </Menu>
      )}
    </span>
  );
}
