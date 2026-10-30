import { memo, useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { Token } from './md';

export { Composer } from './Composer';

// marked loads beside the chat; until it arrives a message shows as plain text.
type Md = typeof import('./md');
let loaded: Md | null = null;
const loading = import('./md').then((m) => (loaded = m));

function useMd() {
  const [m, setM] = useState(loaded);
  useEffect(() => {
    if (!m) void loading.then(setM);
  }, [m]);
  return m;
}

function copyText(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const area = document.createElement('textarea');
  area.value = text;
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  return ok ? Promise.resolve() : Promise.reject(new Error('copy failed'));
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

export function Markdown({ text }: { text: string }) {
  const m = useMd();
  const blocks = useMemo(() => m?.splitBlocks(text), [m, text]);
  if (!m) return <div className="md" style={{ whiteSpace: 'pre-wrap' }}>{text}</div>;
  if (!blocks) {
    return <div className="md" onClick={onCopy} dangerouslySetInnerHTML={{ __html: m.md.parse(text, { async: false }) as string }} />;
  }
  return <div className="md" onClick={onCopy}>{blocks.map((t, i) => <Block key={i} m={m} token={t} />)}</div>;
}
