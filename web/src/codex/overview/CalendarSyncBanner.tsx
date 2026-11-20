import { useSyncStatus } from '../data';
import { clock } from '../tasks/time';
import { scanText } from '../nav';
import { Button } from '../../ui/Button';
import { Row } from '../../ui/Row';
import { openConnectors } from '../../ops/mcpActions';

const ACCOUNT_OF: Record<string, string> = { 'calendar:work': 'alt', 'calendar:personal': 'main' };

// Quiet row on Today while a calendar import fails or stalls, so stale meetings are not trusted.
export function CalendarSyncBanner() {
  const { scans } = useSyncStatus();
  const bad = scans.filter((h) => h.scan.startsWith('calendar:') && scanText(h).bad);
  if (!bad.length) return null;
  return (
    <div className="as-group">
      {bad.map((h) => (
        <Row key={h.scan} title={`Calendar sync failed${h.scan === 'calendar:personal' ? ' (personal)' : bad.length > 1 ? ' (work)' : ''}`}
          meta={h.ok ? `Last synced ${clock(h.ok)}` : 'Never synced'}
          action={<Button size="sm" onClick={() => void openConnectors(ACCOUNT_OF[h.scan])}>Reconnect</Button>} />
      ))}
    </div>
  );
}
