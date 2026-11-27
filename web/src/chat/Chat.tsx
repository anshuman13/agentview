import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { Token } from './transcript/md';
import { copyText } from '../codex/view';
import { getState, setUi } from '../app/store';
import { CopyPathMenu, type MenuPoint } from '../workspace/CopyPathItems';
import { cachedHtml, mdKey, storeHtml } from './transcript/mdCache';
import { fadeRanges, nextTails, wrapRanges, type Tail } from './transcript/streamFade';

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
  const link = (e.target as HTMLElement).closest<HTMLElement>('[data-open]');
  if (link) {
    e.preventDefault();
    return setUi({ openFile: link.dataset.open!, openLine: Number(link.dataset.line) || null, follow: false });
  }
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-copy]');
  if (!btn) return;
  const code = btn.closest('.md-code')?.querySelector('code')?.textContent ?? '';
  copyText(code, 'Code copied');
}

const reduceMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

const Block = memo(
  function Block({ m, token, fade, fresh }: { m: Md; token: Token; fade?: boolean; fresh?: boolean }) {
    const html = m.md.parser([token]);
    const ref = useRef<HTMLDivElement>(null);
    const tails = useRef<{ tails: Tail[]; len: number | null }>({ tails: [], len: fresh ? 0 : null });
    useLayoutEffect(() => {
      const el = ref.current;
      if (!el || !fade || reduceMotion?.matches) return;
      const len = el.textContent?.length ?? 0;
      const now = performance.now();
      const next = nextTails(tails.current.tails, tails.current.len, len, now);
      tails.current = { tails: next, len };
      wrapRanges(el, fadeRanges(next, len, now));
    }, [html, fade]);
    return <div ref={ref} className="md-b" dangerouslySetInnerHTML={{ __html: html }} />;
  },
  (a, b) => a.token.raw === b.token.raw && a.fade === b.fade,
);

export function Markdown({ text, id, files = true, fade, fresh }: { text: string; id?: string; files?: boolean; fade?: boolean; fresh?: boolean }) {
  const m = useMd();
  const born = useRef(fresh);
  const [menu, setMenu] = useState<MenuPoint | null>(null);
  const onMenu = (e: MouseEvent<HTMLDivElement>) => {
    const link = (e.target as HTMLElement).closest<HTMLElement>('[data-open]');
    if (!link) return;
    e.preventDefault();
    setMenu({ path: link.dataset.open!, x: e.clientX, y: e.clientY });
  };
  const copyMenu = menu && <CopyPathMenu path={menu.path} cwd={getState().session.cwd} at={menu} onClose={() => setMenu(null)} />;
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
  const blocks = useMemo(() => (m && files && html === null ? m.splitBlocks(text) : null), [m, files, html, text]);
  // Blocks past the count at the first render arrived while this message was on screen, so their first chunk fades too.
  // A fresh message (one that arrived while its chat was showing) counts none, so its opening words fade.
  const seen = useRef<number | null>(null);
  if (blocks && seen.current === null) seen.current = born.current ? 0 : blocks.length;
  if (!m) return <div className="md" style={{ whiteSpace: 'pre-wrap' }}>{text}</div>;
  if (!files) return <div className="md" onClick={onCopy} dangerouslySetInnerHTML={{ __html: m.mdNoFiles.parse(text, { async: false }) as string }} />;
  let body;
  if (html !== null) body = <div className="md" onClick={onCopy} onContextMenu={onMenu} dangerouslySetInnerHTML={{ __html: html }} />;
  else if (!blocks) body = <div className="md" onClick={onCopy} onContextMenu={onMenu} dangerouslySetInnerHTML={{ __html: m.md.parse(text, { async: false }) as string }} />;
  else body = <div className="md" onClick={onCopy} onContextMenu={onMenu}>{blocks.map((t, i) => <Block key={i} m={m} token={t} fade={fade} fresh={i >= seen.current!} />)}</div>;
  return <>{body}{copyMenu}</>;
}
