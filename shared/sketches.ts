export const SKETCH_COMMAND = { name: 'sketch', description: 'Write a UI mockup as HTML' };

export const sketchPrompt = (what: string) => `Write a UI mockup of ${what.trim() || 'the screen we are discussing in this chat'} as one self-contained file at .claude/sketches/<short-kebab-name>.html. Inline CSS only: no <script>, no external URLs (images as inline SVG or data URIs). Define both themes as CSS variables under html[data-theme="light"] and html[data-theme="dark"]. The layout must work at 390px and 1280px wide. If the project has design tokens, match them. Reply with the path and one line on what it shows.`;

export const isSketchPath = (path: string) => /(^|\/)\.claude\/sketches\/[^/]+\.html$/.test(path);

export const sketchName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export type SketchTheme = 'light' | 'dark';

const GUARD = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"><base target="_blank">`;

const META = /<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

// The page a sketch frame shows: our own html and head come first, so the policy applies to everything the file adds. http-equiv metas
// (refresh) are removed and target attributes renamed, so no link or form can navigate the frame.
export function sketchDoc(html: string, theme: SketchTheme) {
  const clean = html.replace(META, (m) => (/\bhttp-equiv\b/i.test(m) ? '' : m)).replace(/([\s/"'])target\s*=/gi, '$1data-target=');
  const doctype = /^\s*<!doctype[^>]*>/i.exec(clean)?.[0] ?? '';
  return `${doctype}<html data-theme="${theme}"><head>${GUARD}</head>${clean.slice(doctype.length)}`;
}

export const sketchTitle = (name: string) => name.replace(/\.html$/, '');

// The page and the deep link open only a name the list returned.
export const sketchOpenable = (name: string, listed: string[]) => /^[^/]+$/.test(name) && listed.includes(name);
