import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Marked } from 'marked';
import { classHighlighter, highlightCode } from '@lezer/highlight';
import type { Parser } from '@lezer/common';
import { api, setUi } from '../store';
import '../styles/features/doc.css';

type Heading = { id: string; text: string; depth: number };

const ALERTS: Record<string, string> = { note: 'info', tip: 'lightbulb', important: 'report', warning: 'warning', caution: 'error' };
const TAGS = new Set('a abbr b blockquote br button code dd del details div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img input kbd li mark ol p pre s small span strong sub summary sup table tbody td tfoot th thead tr u ul'.split(' '));
const ATTRS = new Set('id class href src alt title width height align open colspan rowspan start type checked disabled data-lang data-copy aria-hidden'.split(' '));

const escapeHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const external = (u: string) => /^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//');

function resolve(base: string, href: string) {
  const dir = href.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const part of href.split('/')) {
    if (part === '..') dir.pop();
    else if (part && part !== '.') dir.push(part);
  }
  return dir.join('/');
}

function frontmatter(text: string) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: '', body: text };
  const rows = m[1].split('\n').map((l) => /^([\w-]+):\s*(.*)$/.exec(l)).filter((r): r is RegExpExecArray => Boolean(r));
  const meta = rows.length ? `<table class="doc-meta"><tbody>${rows.map((r) => `<tr><th>${escapeHtml(r[1])}</th><td>${escapeHtml(r[2].replace(/^["']|["']$/g, ''))}</td></tr>`).join('')}</tbody></table>` : '';
  return { meta, body: text.slice(m[0].length) };
}

function toHtml(text: string) {
  const seen = new Map<string, number>();
  const md = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth, text: raw }) {
        const base = raw.toLowerCase().replace(/<[^>]+>|[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const id = n ? `${base}-${n}` : base;
        return `<h${depth} id="${id}"><a class="doc-anchor" href="#${id}" aria-hidden="true">#</a>${this.parser.parseInline(tokens)}</h${depth}>`;
      },
      code({ text: code, lang }) {
        const name = (lang ?? '').split(/\s/)[0];
        return `<div class="doc-code"><div class="doc-code-bar"><span>${escapeHtml(name)}</span><button class="doc-copy" data-copy="">Copy</button></div><pre><code data-lang="${escapeHtml(name)}">${escapeHtml(code)}</code></pre></div>`;
      },
    },
  });
  const { meta, body } = frontmatter(text);
  return meta + (md.parse(body, { async: false }) as string);
}

const dec = (s: string) => {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
};

function clean(root: ParentNode, path: string) {
  for (const el of [...root.querySelectorAll('*')]) {
    const tag = el.tagName.toLowerCase();
    if (!TAGS.has(tag) || (tag === 'input' && el.getAttribute('type') !== 'checkbox')) {
      el.replaceWith(...(['script', 'style', 'iframe', 'object', 'embed', 'template'].includes(tag) ? [] : [...el.childNodes]));
      continue;
    }
    for (const a of [...el.attributes]) if (!ATTRS.has(a.name)) el.removeAttribute(a.name);
  }
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href')!;
    if (href.startsWith('#')) continue;
    if (/^(https?:|mailto:)/i.test(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noreferrer');
    } else if (external(href)) {
      a.removeAttribute('href');
    } else {
      const [file, hash] = href.split('#');
      const target = file ? resolve(path, dec(file)) : path;
      a.setAttribute('href', target === path && hash ? `#${hash}` : '#');
      if (target !== path) a.setAttribute('data-open', target);
    }
  }
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? '';
    if (/^https?:/i.test(src)) continue;
    if (external(src) || !src) img.removeAttribute('src');
    else img.setAttribute('src', api(`/api/image?path=${encodeURIComponent(resolve(path, dec(src.split(/[?#]/)[0])))}`));
    img.setAttribute('loading', 'lazy');
  }
  for (const input of root.querySelectorAll('input')) {
    input.setAttribute('disabled', '');
    input.closest('li')?.classList.add('doc-task');
  }
  for (const table of root.querySelectorAll('table:not(.doc-meta)')) {
    const wrap = document.createElement('div');
    wrap.className = 'doc-table';
    table.replaceWith(wrap);
    wrap.append(table);
  }
  for (const q of root.querySelectorAll('blockquote')) {
    const first = q.firstElementChild;
    const m = first?.tagName === 'P' ? /^\s*\[!(\w+)\]\s*/.exec(first.textContent ?? '') : null;
    const kind = m?.[1].toLowerCase();
    if (!first || !kind || !ALERTS[kind]) continue;
    const lead = first.firstChild;
    if (lead?.nodeType === Node.TEXT_NODE) lead.textContent = (lead.textContent ?? '').replace(/^\s*\[!\w+\]\s*/, '');
    if (!first.textContent?.trim()) first.remove();
    q.className = `doc-alert doc-alert-${kind}`;
    const title = document.createElement('div');
    title.className = 'doc-alert-title';
    title.innerHTML = `<i class="codicon codicon-${ALERTS[kind]}"></i>${kind[0].toUpperCase()}${kind.slice(1)}`;
    q.prepend(title);
  }
}

const parsers = new Map<string, Promise<Parser | null>>();

function parserFor(lang: string) {
  const l = lang.toLowerCase();
  if (!parsers.has(l)) parsers.set(l, loadParser(l).catch(() => null));
  return parsers.get(l)!;
}

async function loadParser(l: string): Promise<Parser | null> {
  if (['ts', 'tsx', 'typescript', 'js', 'jsx', 'mjs', 'cjs', 'javascript'].includes(l)) return (await import('@codemirror/lang-javascript')).javascript({ typescript: l.startsWith('t'), jsx: l.endsWith('x') }).language.parser;
  if (l === 'py' || l === 'python') return (await import('@codemirror/lang-python')).python().language.parser;
  if (l === 'json' || l === 'jsonc') return (await import('@codemirror/lang-json')).json().language.parser;
  if (['html', 'xml', 'svg', 'vue'].includes(l)) return (await import('@codemirror/lang-html')).html().language.parser;
  if (l === 'css' || l === 'scss') return (await import('@codemirror/lang-css')).css().language.parser;
  if (l === 'md' || l === 'markdown') return (await import('@codemirror/lang-markdown')).markdown().language.parser;
  return null;
}

function highlight(el: HTMLElement, parser: Parser) {
  const code = el.textContent ?? '';
  const out = document.createDocumentFragment();
  const put = (text: string, classes: string) => {
    if (!classes) return out.append(text);
    const span = document.createElement('span');
    span.className = classes;
    span.textContent = text;
    out.append(span);
  };
  highlightCode(code, parser.parse(code), classHighlighter, put, () => out.append('\n'));
  el.replaceChildren(out);
}

export function MarkdownDoc({ path, text }: { path: string; text: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLElement>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState('');
  const last = useRef(path);

  useEffect(() => {
    const el = body.current;
    const box = scroller.current;
    if (!el || !box) return;
    const top = last.current === path ? box.scrollTop : 0;
    last.current = path;
    const tpl = document.createElement('template');
    tpl.innerHTML = toHtml(text);
    clean(tpl.content, path);
    el.replaceChildren(tpl.content);
    box.scrollTop = top;
    setHeadings([...el.querySelectorAll<HTMLElement>('h1, h2, h3')].map((h) => ({ id: h.id, text: h.textContent?.replace(/^#/, '') ?? '', depth: Number(h.tagName[1]) })));
    let cancelled = false;
    for (const code of el.querySelectorAll<HTMLElement>('code[data-lang]')) {
      const lang = code.dataset.lang;
      if (lang) parserFor(lang).then((p) => !cancelled && p && highlight(code, p));
    }
    return () => {
      cancelled = true;
    };
  }, [path, text]);

  useEffect(() => {
    const box = scroller.current;
    if (!box || headings.length < 2) return;
    const onScroll = () => {
      const limit = box.getBoundingClientRect().top + 80;
      let id = headings[0].id;
      for (const h of headings) {
        const node = document.getElementById(h.id);
        if (node && node.getBoundingClientRect().top <= limit) id = h.id;
      }
      setActive(id);
    };
    onScroll();
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => box.removeEventListener('scroll', onScroll);
  }, [headings]);

  const jump = (id: string) => body.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start' });

  const onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    const copy = t.closest<HTMLElement>('[data-copy]');
    if (copy) {
      const code = copy.closest('.doc-code')?.querySelector('code')?.textContent ?? '';
      navigator.clipboard?.writeText(code).then(() => {
        copy.textContent = 'Copied';
        setTimeout(() => (copy.textContent = 'Copy'), 1200);
      });
      return;
    }
    const a = t.closest('a');
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (a.dataset.open) {
      e.preventDefault();
      setUi({ openFile: a.dataset.open });
    } else if (href.startsWith('#')) {
      e.preventDefault();
      if (href.length > 1) jump(decodeURIComponent(href.slice(1)));
    }
  };

  const outline = headings.filter((h) => h.depth > 1);

  return (
    <div className="doc-scroll" ref={scroller}>
      <div className="doc-layout">
        <article className="doc" ref={body} onClick={onClick} />
        {outline.length >= 3 && (
          <nav className="doc-outline">
            <div className="doc-outline-title">On this page</div>
            {outline.map((h) => (
              <a key={h.id} className={`doc-outline-link d${h.depth}${h.id === active ? ' on' : ''}`} href={`#${h.id}`} onClick={(e) => { e.preventDefault(); jump(h.id); }}>
                {h.text}
              </a>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}
