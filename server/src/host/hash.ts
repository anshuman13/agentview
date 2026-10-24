import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Hash of a module and everything it imports by relative path, so a host can tell its code changed on disk.
export function codeHash(entry: string, extra: string[] = []) {
  const scan = new Bun.Transpiler({ loader: 'ts' });
  const seen = new Set<string>();
  const hash = createHash('sha256');
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    let src: string;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      return;
    }
    hash.update(file).update(src);
    for (const { path: spec } of scan.scanImports(src)) if (spec.startsWith('.')) walk(path.resolve(path.dirname(file), spec).replace(/\.js$/, '.ts'));
  };
  walk(entry);
  for (const f of extra) hash.update(readFileSync(f, 'utf8'));
  return hash.digest('hex');
}
