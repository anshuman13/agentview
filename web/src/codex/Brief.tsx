import { useState } from 'react';
import { useAssistantTable } from './data';
import { save, stored } from '../ui/util';
import { Fold } from './Fold';
import { Icon } from '../ui/Icon';
import { useView } from './view';
import { clock } from './time';
import { rowKey } from './data/sync';
import type { Brief } from './data/wiki';
import { DigestCard } from './overview/DigestCard';
import { parseDigest } from './overview/digest';

const DISMISSED = 'codex.briefDismissed';
const DAY = 86400000;
const PREVIEW_LINES = 3;

function BriefBody({ rest }: { rest: string[] }) {
  const [all, setAll] = useState(false);
  const lines = rest.filter((l) => l.trim());
  const long = lines.length > PREVIEW_LINES;
  return (
    <>
      <div className="ov-report full">{all || !long ? rest.join('\n') : lines.slice(0, PREVIEW_LINES).join('\n')}</div>
      {long && <button className="as-chip quiet ov-more" onClick={() => setAll(!all)}>{all ? 'Show less' : 'Show all'}</button>}
    </>
  );
}

const MAX_DISMISSED = 50;

// Today's morning brief from the hub, one per profile, and the day and away digests the hub writes at 17:00, shown for a day from the hub's midnight in any time zone. The morning brief folds to its title; a digest is a report card. The cross hides one card until tomorrow.
export function MorningBrief({ now }: { now: number }) {
  const all = useAssistantTable('briefs');
  const { filter } = useView();
  const [dismissed, setDismissed] = useState<string[]>(() => stored<string[]>(DISMISSED, []));
  const briefs = all.filter((b) => !b.deleted && (b.kind === 'morning' || b.kind === 'day' || b.kind === 'away') && b.from_at != null && now >= b.from_at && now - b.from_at < DAY && b.text && (filter === 'all' || b.profile === filter) && !dismissed.includes(rowKey(b)) && !dismissed.includes(b.profile + b.id))
    .map((b) => ({ b, digest: b.kind === 'morning' ? null : parseDigest(b.kind as 'day' | 'away', b.rows) }))
    .filter((x) => x.b.kind === 'morning' || x.digest)
    .sort((a, b) => Number(b.b.profile === 'work') - Number(a.b.profile === 'work'));
  if (!briefs.length) return null;
  const dismiss = (b: Brief) => {
    const next = [...dismissed.filter((k) => k !== rowKey(b)), rowKey(b)].slice(-MAX_DISMISSED);
    setDismissed(next);
    save(DISMISSED, next);
  };
  return briefs.map(({ b, digest }) => {
    if (digest) return <DigestCard key={rowKey(b)} brief={b} digest={digest} showProfile={filter === 'all'} onDismiss={() => dismiss(b)} />;
    const [title, ...rest] = b.text!.split('\n');
    return (
      <Fold key={rowKey(b)} id={`brief-${b.profile}`} title={`${title}${filter === 'all' ? ` · ${b.profile}` : ''} · ${clock(b.to_at ?? b.from_at!)}`}
        action={<button className="icon-btn" title="Hide until tomorrow" aria-label="Hide the brief until tomorrow" onClick={() => dismiss(b)}><Icon name="close" small /></button>}>
        <BriefBody rest={rest} />
      </Fold>
    );
  });
}
