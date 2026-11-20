import { useDeferredValue, useMemo, useState } from 'react';
import { isNumericColumn, parseCsv, sniffDelimiter, sortRows } from './csv';
import { EmptyState } from '../ui/Panel';

const SHOWN = 1000;

export function CsvTable({ path, text }: { path: string; text: string }) {
  const all = useMemo(() => parseCsv(text, sniffDelimiter(text, path)), [path, text]);
  const [head = [], ...body] = all;
  const cols = Math.max(head.length, ...body.slice(0, 500).map((r) => r.length));
  const [sort, setSort] = useState<{ col: number; desc: boolean } | null>(null);
  const [query, setQuery] = useState('');
  const q = useDeferredValue(query.trim().toLowerCase());
  const numeric = useMemo(() => Array.from({ length: cols }, (_, c) => isNumericColumn(body, c)), [all, cols]);
  const rows = useMemo(() => {
    const numbered = body.map((r, i) => [String(i + 1), ...r]);
    const hit = q ? numbered.filter((r) => r.some((v, c) => c > 0 && v.toLowerCase().includes(q))) : numbered;
    return sort ? sortRows(hit, sort.col + 1, sort.desc) : hit;
  }, [all, q, sort]);
  const pick = (col: number) => setSort((s) => (s?.col !== col ? { col, desc: false } : s.desc ? null : { col, desc: true }));

  if (!head.length) return <EmptyState size="sm" title="Empty file" />;
  return (
    <div className="csv">
      <div className="csv-bar">
        <input placeholder="Filter rows" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
        <span className="csv-count">{rows.length === body.length ? `${body.length} rows` : `${rows.length} of ${body.length} rows`} · {cols} columns{rows.length > SHOWN ? ` · first ${SHOWN} shown` : ''}</span>
      </div>
      <div className="csv-scroll">
        <table>
          <thead>
            <tr>
              <th className="csv-n" />
              {Array.from({ length: cols }, (_, c) => (
                <th key={c} className={numeric[c] ? 'num' : ''} aria-sort={sort?.col === c ? (sort.desc ? 'descending' : 'ascending') : undefined} onClick={() => pick(c)} title="Sort">
                  {head[c] ?? ''}{sort?.col === c && <span className="csv-sort">{sort.desc ? ' ↓' : ' ↑'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, SHOWN).map((r, i) => (
              <tr key={i}>
                <td className="csv-n">{r[0]}</td>
                {Array.from({ length: cols }, (_, c) => <td key={c} className={numeric[c] ? 'num' : ''}>{r[c + 1] ?? ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
