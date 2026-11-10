import { Fragment, useState } from 'react';
import { FileIcon } from '../workspace/FileIcon';
import { Row } from './Row';

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

export function Files({ files, diffs }: { files: { path: string; additions: number; deletions: number }[]; diffs: Map<string, string> }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      {files.map((f) => {
        const name = f.path.split('/').pop()!;
        const shown = open === f.path;
        return (
          <Fragment key={f.path}>
            <Row
              title={name}
              leading={<FileIcon name={name} />}
              meta={f.path.slice(0, -name.length - 1)}
              trailing={<Counts a={f.additions} d={f.deletions} />}
              aria-expanded={shown}
              onClick={() => setOpen(shown ? null : f.path)}
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
