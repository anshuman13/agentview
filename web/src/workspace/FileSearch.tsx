import { useEffect, useState } from 'react';
import { setUi } from '../app/store';
import { Row } from '../ui/Row';
import { FileIcon } from './FileIcon';
import { searchFiles, type SearchHit } from './fileApi';

type Found = { q: string; hits: SearchHit[]; more: boolean } | { q: string; error: string };

export const searching = (q: string) => q.trim().length >= 2;

// Hits for the Files pane's search box as path:line rows; a tap opens the file at the line.
export function FileSearch({ query }: { query: string }) {
  const [found, setFound] = useState<Found | null>(null);
  const q = query.trim();
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      searchFiles(q).then((r) => live && setFound({ q, ...r }), (e) => live && setFound({ q, error: e instanceof Error ? e.message : String(e) }));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  if (!found || found.q !== q) return <div className="ex-hint">Searching…</div>;
  if ('error' in found) return <div className="ex-hint">{found.error}</div>;
  if (!found.hits.length) return <div className="ex-hint">No results</div>;
  return (
    <div className="ex-tree ex-hits" role="list" aria-label="Search results">
      {found.hits.map((h) => (
        <Row
          key={`${h.path}:${h.line}`}
          plain
          role="listitem"
          leading={<FileIcon name={h.path.split('/').pop() ?? h.path} />}
          title={<span className="ex-hit-text">{h.text}</span>}
          meta={`${h.path}:${h.line}`}
          onClick={() => setUi({ openFile: h.path, openLine: h.line, follow: false })}
        />
      ))}
      {found.more && <div className="ex-hint">First 200 results</div>}
    </div>
  );
}
