import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'bun:test';

const src = path.join(__dirname, '..');
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'ui' ? [] : files(p);
    return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [p] : [];
  });

it('uses Button, not hand-made link or wk-act buttons, outside ui/', () => {
  const raw = files(src).flatMap((f) =>
    readFileSync(f, 'utf8').split('\n').flatMap((line, i) => (/<button className="link"|"wk-act"/.test(line) ? [`${path.relative(src, f)}:${i + 1}`] : [])),
  );
  expect(raw).toEqual([]);
});
