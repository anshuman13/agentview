import { useRef, useState } from 'react';
import { IconButton } from '../../ui/Button';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { reviewLabel, usageMenuLabel } from '../../../../shared/chatMenu';
import { command } from '../../ui/util';
import { useStore } from '../../app/store';
import { agentCounts, agentsOf } from '../agents';

type Props = {
  showWork: boolean;
  toggleWork: () => void;
  showAgents: boolean;
  waitingElsewhere: number;
  usage: { account: string | null; week: number | null; fiveHour: number | null; onClick: () => void } | null | undefined;
  macName: string | null | undefined;
  extras: string;
  openAgents: () => void;
  running: boolean;
  hasChanges: boolean;
  review: () => void;
  rename?: () => void;
};

export function ChatDetailsMenu({ showWork, toggleWork, showAgents, waitingElsewhere, usage, macName, extras, openAgents, running, hasChanges, review, rename }: Props) {
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
          <MenuItem icon="edit" disabled={!rename} onClick={rename && choose(rename)}>Rename</MenuItem>
          <MenuItem icon={showWork ? 'check' : undefined} role="menuitemcheckbox" aria-checked={showWork} onClick={choose(toggleWork)}>Show work</MenuItem>
          <MenuItem icon="source-control" disabled={reviewOff} title={reviewOff ? undefined : 'The agent reviews the working tree, findings show in the Changes view'} onClick={choose(review)}>{reviewLabel(running, hasChanges)}</MenuItem>
          <AgentsItem showAgents={showAgents} open={choose(openAgents)} />
          {waitingElsewhere > 0 && <MenuItem icon="inbox" onClick={choose(() => command('view:chats'))}>{waitingElsewhere} waiting</MenuItem>}
          {usageLabel && <MenuItem icon="pulse" onClick={choose(usage.onClick)}>{usageLabel}</MenuItem>}
          {(macName || extras) && <MenuSeparator />}
          {macName && <MenuItem icon="vm" disabled>{macName}</MenuItem>}
          {extras && <MenuItem disabled>{extras}</MenuItem>}
        </Menu>
      )}
    </span>
  );
}

// Mounted only while the menu is open, so streamed events do not rebuild the agents.
function AgentsItem({ showAgents, open }: { showAgents: boolean; open: () => void }) {
  const agents = agentsOf(useStore((s) => s.events));
  const { running, done } = agentCounts(agents);
  if (!agents.length && !showAgents) return null;
  return (
    <MenuItem icon={running ? 'loading' : 'hubot'} spin={running > 0} onClick={open}>
      {showAgents ? 'Back to chat' : `Agents · ${[running && `${running} running`, done && `${done} done`].filter(Boolean).join(', ')}`}
    </MenuItem>
  );
}
