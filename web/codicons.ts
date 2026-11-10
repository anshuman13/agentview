import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

const ICON_RULE = /^\.codicon-([\w-]+):before\b/;
const SOURCES = [path.join(__dirname, 'src'), path.join(__dirname, '../shared')];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

export function codiconNames(css: string) {
  return new Set(css.split('\n').flatMap((line) => ICON_RULE.exec(line)?.[1] ?? []));
}

// Every quoted word or codicon- class in the source that is an icon name. Icon names come from literals, maps and ternaries, so this errs on the side of keeping too many.
export function usedCodicons(css: string, files = SOURCES.flatMap(sourceFiles)) {
  const known = codiconNames(css);
  const used = new Set<string>();
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(/['"`]([a-z][a-z0-9-]*)['"`]|\bcodicon-([a-z][a-z0-9-]*)/g)) {
      const name = m[1] ?? m[2];
      if (known.has(name)) used.add(name);
    }
  }
  return used;
}

export function subsetCodicons(css: string, used: Set<string>) {
  return css
    .split('\n')
    .filter((line) => {
      const name = ICON_RULE.exec(line)?.[1];
      return name === undefined || used.has(name);
    })
    .join('\n');
}

// Import the stylesheet as `@vscode/codicons/dist/codicon.css?used` to get only the icons the web source names.
export function codiconSubset(): Plugin {
  return {
    name: 'codicon-subset',
    enforce: 'pre',
    apply: 'build',
    transform(code, id) {
      if (!/codicon\.css\?used$/.test(id)) return;
      return subsetCodicons(code, usedCodicons(code));
    },
  };
}
