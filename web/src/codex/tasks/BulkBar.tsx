import { Button } from '../../ui/Button';
import type { BulkKind } from '../useActions';

export function BulkBar({ count, enabled, bulk, cancel }: { count: number; enabled: boolean; bulk: (kind: BulkKind) => void; cancel: () => void }) {
  return (
    <div className="as-bulk" role="toolbar" aria-label="Selected tasks">
      <span className="as-bulk-n">{count} selected</span>
      <Button variant="tinted" size="sm" disabled={!enabled} onClick={() => bulk('done')}>Done</Button>
      <Button variant="gray" size="sm" disabled={!enabled} onClick={() => bulk('tomorrow')}>Move to tomorrow</Button>
      <Button variant="gray" size="sm" disabled={!enabled} onClick={() => bulk('snooze')}>Snooze</Button>
      <Button variant="danger" size="sm" disabled={!enabled} onClick={() => bulk('delete')}>Delete</Button>
      <Button variant="plain" size="sm" onClick={cancel}>Cancel</Button>
    </div>
  );
}
