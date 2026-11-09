import { memo, useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { Token } from './transcript/md';
import { copyText } from '../ui/util';
import { cachedHtml, mdKey, storeHtml } from './transcript/mdCache';

export { Composer } from './composer/Composer';

// marked loads beside the chat; until it arrives a message shows as plain text.
type Md = typeof import('./transcript/md');
let loaded: Md | null = null;
const loading = import('./transcript/md').then((m) => (loaded = m));

function useMd() {
  const [m, setM] = useState(loaded);
  useEffect(() => {
    if (!m) void loading.then(setM);
  }, [m]);
  return m;
}

function onCopy(e: MouseEvent<HTMLDivElement>) {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-copy]');
  if (!btn) return;
  const code = btn.closest('.md-code')?.querySelector('code')?.textContent ?? '';
  copyText(code).then(() => {
    btn.textContent = 'Copied';
    setTimeout(() => (btn.textContent = 'Copy'), 1200);
  }, () => {});
}

const Block = memo(
  function Block({ m, token }: { m: Md; token: Token }) {
    const html = m.md.parser([token]);
    return <div className="md-b" dangerouslySetInnerHTML={{ __html: html }} />;
  },
  (a, b) => a.token.raw === b.token.raw,
);

export function Markdown({ text, id }: { text: string; id?: string }) {
  const m = useMd();
  const html = useMemo(() => {
    if (!m || !id) return null;
    const key = mdKey(id, text);
    const hit = cachedHtml(key);
    if (hit !== undefined) return hit;
    const parts = m.splitBlocks(text);
    const out = parts ? m.renderBlocks(parts) : (m.md.parse(text, { async: false }) as string);
    storeHtml(key, out);
    return out;
  }, [m, id, text]);
  const blocks = useMemo(() => (m && html === null ? m.splitBlocks(text) : null), [m, html, text]);
  if (!m) return <div className="md" style={{ whiteSpace: 'pre-wrap' }}>{text}</div>;
  if (html !== null) return <div className="md" onClick={onCopy} dangerouslySetInnerHTML={{ __html: html }} />;
  if (!blocks) {
    return <div className="md" onClick={onCopy} dangerouslySetInnerHTML={{ __html: m.md.parse(text, { async: false }) as string }} />;
  }
  return <div className="md" onClick={onCopy}>{blocks.map((t, i) => <Block key={i} m={m} token={t} />)}</div>;
}
