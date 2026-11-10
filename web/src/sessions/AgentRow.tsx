import type { ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { useTick } from '../ui/util';
import { elapsed } from './agents';
import type { AgentStatus, LiveAgent } from '../../../shared/protocol';

export const STATUS_ICON: Record<AgentStatus, string> = { running: 'loading', done: 'check', failed: 'error', stopped: 'debug-stop' };

export function AgentRow({ status, description, meta, trailing, current, onClick }: { status: AgentStatus; description: string; meta: string; trailing: ReactNode; current?: boolean; onClick?: () => void }) {
  return (
    <Row
      className="ag-item"
      aria-current={current ? 'true' : undefined}
      leading={<span className={`ag-mark ${status}`}><Icon name={STATUS_ICON[status]} small spin={status === 'running'} /></span>}
      title={<span title={description}>{description}</span>}
      meta={<span title={meta}>{meta}</span>}
      trailing={trailing}
      onClick={onClick}
    />
  );
}

export function AgentsBlock({ agents, open, onToggle, onOpen }: { agents: LiveAgent[]; open: boolean; onToggle: () => void; onOpen: (id: string) => void }) {
  const now = useTick(1000, open);
  return (
    <div className="chat-agents">
      <Section label="Agents" count={agents.length} open={open} onToggle={onToggle} />
      {open && agents.map((a) => (
        <AgentRow key={a.id} status="running" description={a.description} meta={a.group ? `Running · ${a.group}` : 'Running'} trailing={elapsed(now - a.startedAt)} onClick={() => onOpen(a.id)} />
      ))}
    </div>
  );
}
