import { readFileSync } from 'node:fs';
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileDiff } from '../../../../shared/lineDiff.js';
import type { FileUpdateChange } from './protocol.js';

export const SHELL_NOTE = 'Edits made by shell commands are not tracked and stay as they are.';

// Each prompt's files as they were before its turn first changed them; null for a file that did not exist.
export class Checkpoints {
  private prompts: { id: string; files: Map<string, string | null> }[] = [];

  begin(id: string) {
    if (!this.prompts.some((p) => p.id === id)) this.prompts.push({ id, files: new Map() });
  }

  // Read at once: Codex applies the change right after announcing it.
  keep(cwd: string, changes: FileUpdateChange[]) {
    const files = this.prompts.at(-1)?.files;
    if (!files) return;
    const paths = changes.flatMap((c) => [c.path, ...(c.kind.type === 'update' && c.kind.move_path ? [c.kind.move_path] : [])]);
    for (const p of paths.map((f) => path.resolve(cwd, f))) {
      if (files.has(p)) continue;
      files.set(p, read(p));
    }
  }

  // The oldest saved contents of every file changed by this prompt and the ones after it.
  private before(id: string) {
    const at = this.prompts.findIndex((p) => p.id === id);
    if (at < 0) return null;
    const out = new Map<string, string | null>();
    for (const p of this.prompts.slice(at)) for (const [f, c] of p.files) if (!out.has(f)) out.set(f, c);
    return { at, files: out };
  }

  async rewind(id: string, dryRun = false) {
    const b = this.before(id);
    if (!b || !b.files.size) return { canRewind: false, error: 'No checkpoint for that prompt' };
    let insertions = 0;
    let deletions = 0;
    for (const [f, prior] of b.files) {
      const now = await readFile(f, 'utf8').catch(() => null);
      for (const [mark] of fileDiff(prior ?? '', now ?? '')) {
        if (mark === '+') insertions++;
        else if (mark === '-') deletions++;
      }
      if (dryRun) continue;
      if (prior === null) await rm(f, { force: true });
      else {
        await mkdir(path.dirname(f), { recursive: true });
        await writeFile(f, prior);
      }
    }
    if (!dryRun) this.prompts.splice(b.at);
    return { canRewind: true, filesChanged: [...b.files.keys()], insertions, deletions, note: SHELL_NOTE };
  }
}

function read(file: string) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
