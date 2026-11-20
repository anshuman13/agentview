import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'bun:test';

const src = path.join(__dirname, '..');
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [p] : [];
  });

it('gives every "Could not load" EmptyState a Retry action', () => {
  const missing = files(src).flatMap((f) =>
    readFileSync(f, 'utf8').split('\n').flatMap((line, i) => (/<EmptyState[^\n]*title="Could not load/.test(line) && !line.includes('action=') ? [`${path.relative(src, f)}:${i + 1}`] : [])),
  );
  expect(missing).toEqual([]);
});
