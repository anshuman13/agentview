import { Marked, type Token } from 'marked';
import { escapeHtml } from '../../ui/util';

export type { Token };

// A file path a reply names: absolute, home or relative, with an extension and an optional :line.
// Relative paths need a folder unless they are Markdown or CSV, so `x.ts` alone stays code.
export function filePath(text: string): { path: string; line?: number } | null {
  const m = /^((?:~|\.{1,2})?\/?[^\s:*?"<>|`]*\.[A-Za-z][A-Za-z0-9]{0,7})(?::(\d+)(?::\d+)?|#L(\d+))?$/.exec(text.trim());
  if (!m || /^[a-z][a-z0-9+.-]*:/i.test(text) || m[1].includes('//')) return null;
  if (!m[1].includes('/') && !/\.(md|markdown|mdx|csv|tsv)$/i.test(m[1])) return null;
  const line = Number(m[2] ?? m[3]) || undefined;
  return { path: m[1].replace(/^\.\//, ''), ...(line && { line }) };
}

const openAttrs = (f: { path: string; line?: number }) => `href="#" data-open="${escapeHtml(f.path)}"${f.line ? ` data-line="${f.line}"` : ''}`;

export const md = new Marked({
  gfm: true,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    code: ({ text, lang }) =>
      `<div class="md-code"><button class="md-copy" data-copy="">Copy</button><pre><code${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}>${escapeHtml(text)}</code></pre></div>`,
    codespan({ text }) {
      const f = filePath(text.replace(/&amp;/g, '&'));
      return f ? `<a class="md-file" ${openAttrs(f)}><code>${text}</code></a>` : `<code>${text}</code>`;
    },
    link({ href, tokens }) {
      const f = filePath(decodeURI(href));
      if (f) return `<a class="md-file" ${openAttrs(f)}>${this.parser.parseInline(tokens)}</a>`;
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
