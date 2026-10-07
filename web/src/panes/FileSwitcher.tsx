import { useEffect, useMemo, useRef, useState } from 'react';
import { setUi, useStore } from '../store';

export function FileSwitcher() {
  const open = useStore((s) => s.ui.switcherOpen);
  const recent = useStore((s) => s.recentFiles);
  const [files, setFiles] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setIdx(0);
    fetch('/api/files').then((r) => r.json()).then(setFiles);
    setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  const results = useMemo(() => {
    if (!q) return [...recent, ...files.filter((f) => !recent.includes(f))].slice(0, 40);
    const needle = q.toLowerCase();
    return files
      .map((f) => ({ f, s: score(f.toLowerCase(), needle) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.f);
  }, [q, files, recent]);

  if (!open) return null;

  const pick = (f: string) => {
    setUi({ openFile: f, switcherOpen: false, follow: false });
  };

  return (
    <div className="overlay" onClick={() => setUi({ switcherOpen: false })}>
      <div className="switcher" onClick={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          placeholder="Open file…"
          onChange={(e) => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setUi({ switcherOpen: false });
            if (e.key === 'ArrowDown') setIdx((i) => Math.min(i + 1, results.length - 1));
            if (e.key === 'ArrowUp') setIdx((i) => Math.max(i - 1, 0));
            if (e.key === 'Enter' && results[idx]) pick(results[idx]);
          }}
        />
        <ul>
          {results.map((f, i) => (
            <li key={f} className={`${i === idx ? 'active' : ''} ${recent.includes(f) ? 'recent' : ''}`} onClick={() => pick(f)}>
              <span className="mono">{f}</span>
              {recent.includes(f) && <span className="tag">changed</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function score(hay: string, needle: string): number {
  let hi = 0, s = 0, streak = 0;
  for (const ch of needle) {
    const at = hay.indexOf(ch, hi);
    if (at < 0) return 0;
    streak = at === hi ? streak + 1 : 0;
    s += 1 + streak * 2 + (at === 0 || '/._-'.includes(hay[at - 1]) ? 3 : 0);
    hi = at + 1;
  }
  return s + Math.max(0, 40 - hay.length) / 40;
}
