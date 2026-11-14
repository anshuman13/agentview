import type { ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { Row } from '../ui/Row';
import type { AgentStatus } from '../../../shared/protocol';

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

