import { memo, useMemo, type MouseEvent } from 'react';
import { Marked, type Token } from 'marked';
import { escapeHtml } from '../ui/util';

export { Composer } from './Composer';

export const md = new Marked({
  gfm: true,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    code: ({ text, lang }) =>
      `<div class="md-code"><button class="md-copy" data-copy="">Copy</button><pre><code${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}>${escapeHtml(text)}</code></pre></div>`,
    link({ href, tokens }) {
      const safe = /^(https?:|mailto:)/i.test(href) ? href : '#';
      return `<a href="${escapeHtml(safe)}" target="_blank" rel="noreferrer">${this.parser.parseInline(tokens)}</a>`;
    },
    // A model-written image would load its URL on render and could leak text in the query, so it shows as a link.
    image({ href, text }) {
      const safe = /^https?:/i.test(href) ? href : '#';
      return `<a href="${escapeHtml(safe)}" target="_blank" rel="noreferrer">${escapeHtml(text || href)}</a>`;
    },
  },
});

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

export function splitBlocks(text: string): Token[] | null {
  const tokens = md.lexer(text);
  if (Object.keys(tokens.links).length) return null;
  return tokens.filter(t => t.type !== 'space');
}

export function renderBlocks(blocks: Token[]) {
  return blocks.map(t => md.parser([t])).join('');
}

const Block = memo(
  function Block({ token }: { token: Token }) {
    const html = md.parser([token]);
    return <div className="md-b" dangerouslySetInnerHTML={{ __html: html }} />;
  },
  (a, b) => a.token.raw === b.token.raw,
);

export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => splitBlocks(text), [text]);
  if (!blocks) {
    return <div className="md" onClick={onCopy} dangerouslySetInnerHTML={{ __html: md.parse(text, { async: false }) as string }} />;
  }
  return <div className="md" onClick={onCopy}>{blocks.map((t, i) => <Block key={i} token={t} />)}</div>;
}
