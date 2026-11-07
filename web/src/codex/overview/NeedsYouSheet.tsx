import { useEffect, useState } from 'react';
import type { ItemRow } from '../data/sync';
import { Back } from '../../app/back';
import { useEscape } from '../../ui/util';
import { useSheetDrag } from '../../ui/useSheetDrag';
import { NeedsYou, type useNeedsYou } from '../NeedsYou';
import { ReplyQueue, staleAsks } from './ReplyQueue';

// The Needs you list then the Reply queue in a bottom sheet; "asks older than 3 days" narrows the queue to those asks.
export function NeedsYouSheet({ needs, queue, now, onClose }: { needs: ReturnType<typeof useNeedsYou>; queue: ItemRow[]; now: number; onClose: () => void }) {
  const sheet = useSheetDrag(true, onClose);
  useEscape(sheet.close);
  const [onlyStale, setOnlyStale] = useState(false);
  const old = staleAsks(queue, now);
  const filtered = onlyStale && old.length > 0;
  useEffect(() => { if (onlyStale && !old.length) setOnlyStale(false); }, [onlyStale, old.length]);
  const showOld = () => {
    setOnlyStale(true);
    requestAnimationFrame(() => document.getElementById('reply-queue')?.scrollIntoView({ block: 'start' }));
  };
  return (
    <div className="as-sheet-overlay" ref={sheet.overlay} onClick={sheet.close}>
      <Back close={onClose} />
      <div className="as-sheet" ref={sheet.sheet} role="dialog" aria-label="Needs you" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" {...sheet.handle} />
        <NeedsYou n={needs} now={now} onShowOld={showOld} />
        <ReplyQueue rows={filtered ? old : queue} filtered={filtered} onClear={() => setOnlyStale(false)} />
      </div>
    </div>
  );
}
