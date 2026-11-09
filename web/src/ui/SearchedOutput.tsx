import { useEffect, useMemo, useRef, useState } from 'react';
import { queryWords } from '../codex/data/ask/match';
import { Icon } from './Icon';
import { IconButton } from './Button';
import { markSegments, matchLabel, stepMatch } from './util';

export function SearchedOutput({ text, query, setQuery, label, className }: { text: string; query: string; setQuery: (q: string) => void; label: string; className: string }) {
  const [cur, setCur] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const segs = useMemo(() => markSegments(text, queryWords(query)), [text, query]);
  const count = segs.filter((s) => s.hit).length;
  useEffect(() => setCur(-1), [text]);
  const change = (q: string) => { setQuery(q); setCur(-1); };
  const step = (dir: 1 | -1) => {
    if (!count) return;
    const n = stepMatch(cur, dir, count);
    setCur(n);
    box.current?.querySelectorAll('mark')[n]?.scrollIntoView({ block: 'center' });
  };
  let k = -1;
  return (
    <>
      <div className="jb-search-row">
        <label className="jb-search">
          <Icon name="search" small />
          <input enterKeyHint="search" value={query} placeholder="Search" aria-label={label} onChange={(e) => change(e.target.value)} onKeyDown={(e) => {
            if (e.key === 'Escape') { e.stopPropagation(); if (query) change(''); else e.currentTarget.blur(); }
            else if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
          }} />
          {query && <button className="icon-btn" aria-label="Clear" onClick={() => change('')}><Icon name="close" small /></button>}
        </label>
        {query.trim() && <span className="muted small">{matchLabel(count)}</span>}
        <IconButton size="sm" icon="arrow-up" label="Previous match" disabled={!count} onClick={() => step(-1)} />
        <IconButton size="sm" icon="arrow-down" label="Next match" disabled={!count} onClick={() => step(1)} />
      </div>
      <div className={className} ref={box}>
        {segs.map((s, i) => s.hit ? <mark key={i} className={++k === cur ? 'cur' : undefined}>{s.text}</mark> : s.text)}
      </div>
    </>
  );
}
