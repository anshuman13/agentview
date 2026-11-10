import { Badge } from '../../ui/Badge';
import { IconButton } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { Sheet } from '../../ui/Sheet';
import type { ChatEvent } from '../../../../shared/protocol';
import { summaryCounts, summarySteps, turnSummary, type SummaryEntry } from './summary';

const ICONS: Record<SummaryEntry['kind'], string> = { status: 'pulse', search: 'search', page: 'globe', explore: 'list-tree', agent: 'sparkle', work: 'tools' };

export function SummaryRows({ entries }: { entries: SummaryEntry[] }) {
  return (
    <div className="ui-group">
      {entries.map((e) => (
        <Row
          key={e.id}
          plain
          leading={<Icon name={ICONS[e.kind]} small />}
          title={e.title}
          meta={e.meta}
          state={e.failed ? <Badge status="failed" /> : e.running ? <Badge status="running" /> : undefined}
          action={e.url ? <IconButton icon="link-external" label="Open page" size="sm" href={e.url} /> : undefined}
        />
      ))}
    </div>
  );
}

export function SummarySheet({ events, onClose }: { events: ChatEvent[]; onClose: () => void }) {
  const entries = turnSummary(events);
  return (
    <Sheet label="Summary" onClose={onClose}>
      <Section label="Summary" count={summaryCounts(entries, summarySteps(events))} />
      <SummaryRows entries={entries} />
    </Sheet>
  );
}
