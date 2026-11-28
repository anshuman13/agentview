import { Fragment, useEffect, useState } from 'react';
import { toggled } from '../workspace/diffView';
import { FileIcon } from '../workspace/FileIcon';
import { Row } from './Row';
import '../styles/features/github.css';

export const Counts = ({ a, d }: { a: number; d: number }) => <span className="gh-counts"><span className="add">+{a}</span> <span className="del">-{d}</span></span>;

export function splitDiff(diff: string) {
  const files = new Map<string, string>();
  for (const part of diff.split(/^(?=diff --git )/m)) {
    const m = part.match(/^diff --git a\/.* b\/(.*)$/m);
    if (m) files.set(m[1], part.slice(part.indexOf('\n@@') + 1 || part.length));
  }
  return files;
}

const lineClass = (l: string) => (l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : l.startsWith('@@') ? 'hunk' : '');

// A folder path that wraps after its slashes before it breaks inside a folder name.
const breakAtSlashes = (dir: string) => dir.split('/').map((s, i) => <Fragment key={i}>{i > 0 && <>/<wbr /></>}{s}</Fragment>);

// fold.n changes each time Collapse all or Expand all is picked.
export function Files({ files, diffs, fold }: { files: { path: string; additions: number; deletions: number }[]; diffs: Map<string, string>; fold?: { open: boolean; n: number } }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (fold) setOpen(new Set(fold.open ? files.map((f) => f.path) : []));
  }, [fold?.n]);
  return (
    <>
      {files.map((f) => {
        const name = f.path.split('/').pop()!;
        const shown = open.has(f.path);
        return (
          <Fragment key={f.path}>
            <Row
              title={name}
              leading={<FileIcon name={name} />}
              meta={f.path.includes('/') && breakAtSlashes(f.path.slice(0, -name.length - 1))}
              trailing={<Counts a={f.additions} d={f.deletions} />}
              aria-expanded={shown}
              onClick={() => setOpen(toggled(open, f.path))}
            />
            {shown && (
              <pre className="gh-diff">{(diffs.get(f.path) ?? 'No diff').split('\n').map((l, i) => <div key={i} className={lineClass(l)}>{l || ' '}</div>)}</pre>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
