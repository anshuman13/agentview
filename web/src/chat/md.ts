import { Marked, type Token } from 'marked';
import { escapeHtml } from '../ui/util';

export type { Token };

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

export function splitBlocks(text: string): Token[] | null {
  const tokens = md.lexer(text);
  if (Object.keys(tokens.links).length) return null;
  return tokens.filter(t => t.type !== 'space');
}

export function renderBlocks(blocks: Token[]) {
  return blocks.map(t => md.parser([t])).join('');
}
