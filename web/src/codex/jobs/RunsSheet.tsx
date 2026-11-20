import { useState } from 'react';
import type { Job, Run } from '../data/wiki/wiki';
import { ask, runAsk } from '../data/ask/ask';
import { Badge } from '../../ui/Badge';
import { Icon } from '../../ui/Icon';
import { Button } from '../../ui/Button';
import { Markdown } from '../../chat/Chat';
import { Row } from '../../ui/Row';
import { Section, sectionCount } from '../../ui/Section';
import { SearchedOutput } from '../../ui/SearchedOutput';
import { Sheet } from '../../ui/Sheet';
import { copyText } from '../view';
import { at, runMeta } from './schedule';

const runBadge = (r: Run) => <Badge status={r.status === 'running' ? 'running' : r.status === 'ok' ? 'done' : 'failed'} reason={r.status === 'ok' ? 'Succeeded' : undefined} />;

function CopyOutput({ r }: { r: Run }) {
  return <Button variant="plain" size="sm" icon="copy" onClick={() => copyText(r.output!, 'Output copied')}>Copy output</Button>;
}

export function RunRow({ r, latest, query, setQuery, onAsk }: { r: Run; latest: boolean; query: string; setQuery: (q: string) => void; onAsk: () => void }) {
  const [open, setOpen] = useState(latest);
  const meta = runMeta(r);
  const output = r.output && <div className="jb-md"><Markdown text={r.output} files={false} /></div>;
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
          <div className="jb-run-tools"><CopyOutput r={r} /><Button variant="plain" size="sm" icon="sparkle" onClick={onAsk}>Ask Claude</Button></div>
          {latest ? <SearchedOutput text={r.output} query={query} setQuery={setQuery} label="Search output" className="jb-output">{output}</SearchedOutput> : output}
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
export function RunsSheet({ job, runs, query, setQuery, onClose }: { job: Job; runs: Run[]; query: string; setQuery: (q: string) => void; onClose: () => void }) {
  const shown = runs.slice(0, 10);
  const askAbout = (r: Run) => { if (ask(runAsk(job.name || 'Untitled job', r.started_at ?? 0, r.output!), job.profile)) onClose(); };
  return (
    <Sheet label="Runs" onClose={onClose}>
      <Section label="Runs" count={sectionCount(shown.length)} />
      <div className="as-group">
        {shown.map((r, i) => <RunRow key={r.id} r={r} latest={i === 0} query={query} setQuery={setQuery} onAsk={() => askAbout(r)} />)}
      </div>
    </Sheet>
  );
}
