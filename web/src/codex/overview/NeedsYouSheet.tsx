import { useEffect, useState } from 'react';
import type { ItemRow } from '../data/sync';
import { Section, sectionCount } from '../../ui/Section';
import { IconButton } from '../../ui/Button';
import { AskRow } from '../../ui/AskRow';
import { Row } from '../../ui/Row';
import { safeHref } from '../../ui/util';
import { Fold } from '../Fold';
import { CAP } from '../data/tasks/needsYou';
import type { Ignored } from '../data/tasks/review';
import { Sheet } from '../../ui/Sheet';
import { NeedsYou, type useNeedsYou } from '../NeedsYou';
import { ReplyQueue, staleAsks } from './ReplyQueue';

// What the scan did not take as asks today, folded below Replies: the newest few, then Show all.
function IgnoredToday({ list }: { list: Ignored[] }) {
  const [all, setAll] = useState(false);
  return (
    <Fold id="ignored-today" title="Ignored today" count={list.length} remember={false}>
      <div className="as-group ov-queue-group">
        {(all ? list : list.slice(0, CAP)).map((e) => (
          <Row key={e.url} plain lines={1} title={e.from} meta={e.gist} action={<IconButton size="sm" icon="link-external" label="Open" href={safeHref(e.url)} />} />
        ))}
        {!all && list.length > CAP && <AskRow title={`Show all ${list.length}`} onClick={() => setAll(true)} />}
      </div>
    </Fold>
  );
}

// Needs you total, then Tasks, Asks and Replies in a bottom sheet, a centred dialog from 901px; "asks older than 3 days" narrows the queue to those asks.
export function NeedsYouSheet({ needs, queue, ignored, now, onClose, onAsk }: { needs: ReturnType<typeof useNeedsYou>; queue: ItemRow[]; ignored: Ignored[]; now: number; onClose: () => void; onAsk: (r: ItemRow) => void }) {
  const [onlyStale, setOnlyStale] = useState(false);
  const old = staleAsks(queue, now);
  const filtered = onlyStale && old.length > 0;
  useEffect(() => { if (onlyStale && !old.length) setOnlyStale(false); }, [onlyStale, old.length]);
  const showOld = () => {
    setOnlyStale(true);
    requestAnimationFrame(() => document.getElementById('reply-queue')?.scrollIntoView({ block: 'start' }));
  };
  return (
    <Sheet label="Needs you" onClose={onClose} className="as-dialog">
      <Section label="Needs you" count={sectionCount(needs.rows.length + queue.length)} />
      <NeedsYou n={needs} now={now} onShowOld={showOld} />
      <ReplyQueue rows={filtered ? old : queue} filtered={filtered} onClear={() => setOnlyStale(false)} onAsk={onAsk} />
      {!filtered && <IgnoredToday list={ignored} />}
    </Sheet>
  );
}
