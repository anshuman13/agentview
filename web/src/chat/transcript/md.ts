import { Marked, type Token } from 'marked';
import { escapeHtml } from '../../ui/util';
import { shellLine } from '../../../../shared/composerText';

export type { Token };

// A file path a reply names: absolute, home or relative, with an extension and an optional :line.
// Relative paths need a folder unless they are Markdown or CSV, so `x.ts` alone stays code. A link target may hold spaces.
const pathRe = (chars: string) => new RegExp(`^((?:~|\\.{1,2})?\\/?[^${chars}:*?"<>|\`]*\\.[A-Za-z][A-Za-z0-9]{0,7})(?::(\\d+)(?::\\d+)?|#L(\\d+))?$`);
const CODE_PATH = pathRe('\\s');
const LINK_PATH = pathRe('\\n');

export function filePath(text: string, link = false): { path: string; line?: number } | null {
  const m = (link ? LINK_PATH : CODE_PATH).exec(text.trim());
  if (!m || /^[a-z][a-z0-9+.-]*:/i.test(text) || m[1].includes('//')) return null;
  if (!m[1].includes('/') && !/\.(md|markdown|mdx|csv|tsv)$/i.test(m[1])) return null;
  const line = Number(m[2] ?? m[3]) || undefined;
  return { path: m[1].replace(/^\.\//, ''), ...(line && { line }) };
}

const openAttrs = (f: { path: string; line?: number }) => `href="#" data-open="${escapeHtml(f.path)}"${f.line ? ` data-line="${f.line}"` : ''}`;

const decoded = (href: string) => {
  try {
    return decodeURI(href);
  } catch {
    return href;
  }
};

// With `files` false, paths stay plain code and links, for text that is not about a chat's folder.
const markdown = (files: boolean) => new Marked({
  gfm: true,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    code({ text, lang }) {
      const run = shellLine(lang, text);
      const acts = `${run ? `<button class="md-run" data-run="${escapeHtml(run)}">Run in terminal</button>` : ''}<button class="md-copy" data-copy="">Copy</button>`;
      return `<div class="md-code"><div class="md-acts">${acts}</div>${lang ? `<span class="md-lang">${escapeHtml(lang)}</span>` : ''}<pre><code${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}>${escapeHtml(text)}</code></pre></div>`;
    },
    codespan({ text }) {
      const f = files && filePath(text.replace(/&amp;/g, '&'));
      return f ? `<a class="md-file" ${openAttrs(f)}><code>${text}</code></a>` : `<code>${text}</code>`;
    },
    link({ href, tokens }) {
      const f = files && filePath(decoded(href), true);
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

export const md = markdown(true);
export const mdNoFiles = markdown(false);

export function splitBlocks(text: string): Token[] | null {
  const tokens = md.lexer(text);
  if (Object.keys(tokens.links).length) return null;
  return tokens.filter(t => t.type !== 'space');
}

export function renderBlocks(blocks: Token[]) {
  return blocks.map(t => md.parser([t])).join('');
}
