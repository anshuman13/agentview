import { useMemo, type MouseEvent } from 'react';
import { Marked } from 'marked';
import { escapeHtml } from '../ui/util';

export { Composer } from './Composer';

const md = new Marked({
  gfm: true,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    code: ({ text, lang }) =>
      `<div class="md-code"><button class="md-copy" data-copy="">Copy</button><pre><code${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}>${escapeHtml(text)}</code></pre></div>`,
    link({ href, tokens }) {
      const safe = /^(https?:|mailto:)/i.test(href) ? href : '#';
      return `<a href="${escapeHtml(safe)}" target="_blank" rel="noreferrer">${this.parser.parseInline(tokens)}</a>`;
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

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => md.parse(text, { async: false }) as string, [text]);
  return <div className="md" onClick={onCopy} dangerouslySetInnerHTML={{ __html: html }} />;
}
