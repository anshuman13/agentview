import { useMemo } from 'react';
import { Marked } from 'marked';

export { Composer } from './Composer';

const md = new Marked({
  gfm: true,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    link({ href, tokens }) {
      const safe = /^(https?:|mailto:)/i.test(href) ? href : '#';
      return `<a href="${escapeHtml(safe)}" target="_blank" rel="noreferrer">${this.parser.parseInline(tokens)}</a>`;
    },
  },
});

function escapeHtml(t: string) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => md.parse(text, { async: false }) as string, [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
