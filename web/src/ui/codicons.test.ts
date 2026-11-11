import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { codiconNames, subsetCodicons, usedCodicons } from '../../codicons';

const css = readFileSync(path.join(__dirname, '../../../node_modules/@vscode/codicons/dist/codicon.css'), 'utf8');
const src = path.join(__dirname, '..');
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });

describe('codicon subset', () => {
  const known = codiconNames(css);
  const subset = codiconNames(subsetCodicons(css, usedCodicons(css)));

  it('keeps every icon a prop, map or ternary names in the web source', () => {
    const missing: string[] = [];
    for (const file of files(src)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/(?:<Icon name|\bicon)=(?:"([^"]*)"|\{([^{}]*)\})|\bicon: ('[^']*'|"[^"]*")/g)) {
        for (const t of (m[1] ?? m[2] ?? m[3]).matchAll(/['"]?([a-z][a-z0-9-]*)['"]?/g)) {
          if (known.has(t[1]) && !subset.has(t[1])) missing.push(`${path.relative(src, file)}: ${t[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('has no icon name built from a template, which the scan cannot see', () => {
    const built = files(src).filter((f) => /(?:<Icon name|\bicon)=\{`|\bicon: `/.test(readFileSync(f, 'utf8')));
    expect(built.map((f) => path.relative(src, f))).toEqual([]);
  });
});
