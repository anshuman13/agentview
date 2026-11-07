import { useState } from 'react';
import type { Run } from '../data/wiki';
import { Badge } from '../../ui/Badge';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { Section, sectionCount } from '../../ui/Section';
import { SearchedOutput } from '../../ui/SearchedOutput';
import { Sheet } from '../../ui/Sheet';
import { copyText } from '../view';
import { at, runMeta } from './schedule';

const runBadge = (r: Run) => <Badge status={r.status === 'running' ? 'running' : r.status === 'ok' ? 'done' : 'failed'} reason={r.status === 'ok' ? 'Succeeded' : undefined} />;

function CopyOutput({ r }: { r: Run }) {
  return <button className="icon-btn" title="Copy output" aria-label="Copy output" onClick={() => copyText(r.output!, 'Output copied')}><Icon name="copy" small /></button>;
}

export function RunRow({ r, latest, query, setQuery }: { r: Run; latest: boolean; query: string; setQuery: (q: string) => void }) {
  const [open, setOpen] = useState(latest);
  const meta = runMeta(r);
  return (
    <div className="jb-run">
      <Row
        plain={!r.output}
        title={at(r.started_at ?? 0)}
        meta={meta || undefined}
        trailing={<>{runBadge(r)}{r.output && <Icon name={open ? 'chevron-down' : 'chevron-right'} small />}</>}
        aria-expanded={r.output ? open : undefined}
        onClick={r.output ? () => setOpen(!open) : undefined}
      />
      {open && r.output && (
        <div className="jb-run-body">
          <div className="jb-run-tools"><CopyOutput r={r} /></div>
          {latest ? <SearchedOutput text={r.output} query={query} setQuery={setQuery} label="Search output" className="jb-output" /> : <div className="jb-output">{r.output}</div>}
        </div>
      )}
    </div>
  );
}

export function RunsRow({ latest, onOpen }: { latest?: Run; onOpen: () => void }) {
  if (!latest) return <Row plain title="Runs" meta="Not run yet" />;
  return <Row title="Runs" meta={at(latest.started_at ?? 0)} trailing={<>{runBadge(latest)}<Icon name="chevron-right" small /></>} onClick={onOpen} />;
}

// The 10 latest runs of a job in a bottom sheet; the latest starts open with the output search.
export function RunsSheet({ runs, query, setQuery, onClose }: { runs: Run[]; query: string; setQuery: (q: string) => void; onClose: () => void }) {
  const shown = runs.slice(0, 10);
  return (
    <Sheet label="Runs" onClose={onClose}>
      <Section label="Runs" count={sectionCount(shown.length)} />
      <div className="as-group">
        {shown.map((r, i) => <RunRow key={r.id} r={r} latest={i === 0} query={query} setQuery={setQuery} />)}
      </div>
    </Sheet>
  );
}
