import { useEffect, useState } from 'react';
import type { ItemRow } from '../data/sync';
import { Section, sectionCount } from '../../ui/Section';
import { Sheet } from '../../ui/Sheet';
import { NeedsYou, type useNeedsYou } from '../NeedsYou';
import { ReplyQueue, staleAsks } from './ReplyQueue';

// Needs you total, then Tasks, Asks and Replies in a bottom sheet; "asks older than 3 days" narrows the queue to those asks.
export function NeedsYouSheet({ needs, queue, now, onClose }: { needs: ReturnType<typeof useNeedsYou>; queue: ItemRow[]; now: number; onClose: () => void }) {
  const [onlyStale, setOnlyStale] = useState(false);
  const old = staleAsks(queue, now);
  const filtered = onlyStale && old.length > 0;
  useEffect(() => { if (onlyStale && !old.length) setOnlyStale(false); }, [onlyStale, old.length]);
  const showOld = () => {
    setOnlyStale(true);
    requestAnimationFrame(() => document.getElementById('reply-queue')?.scrollIntoView({ block: 'start' }));
  };
  return (
    <Sheet label="Needs you" onClose={onClose}>
      <Section label="Needs you" count={sectionCount(needs.rows.length + queue.length)} />
      <NeedsYou n={needs} now={now} onShowOld={showOld} />
      <ReplyQueue rows={filtered ? old : queue} filtered={filtered} onClear={() => setOnlyStale(false)} />
    </Sheet>
  );
}
