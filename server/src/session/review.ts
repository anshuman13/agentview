import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { ReviewFile, ReviewHunk, ReviewState } from '../../../shared/protocol.js';
import { fileDiff, revertBlock } from '../../../shared/lineDiff.js';
import { errText, inside } from '../../../shared/util.js';
import { safeResolve, writeFileText } from '../workspace/files.js';
import type { AgentSession } from './session.js';

const MAX_TEXT = 1_000_000;
const KEPT_REVIEWS = 5;
export const STALE = 'This change was edited since; open the file to undo it';
const NO_TEXT = 'The text before this turn is no longer kept; open the file to undo it';

// The file's text before the turn: null when it did not exist, binary when it cannot be read as text.
type Before = { text: string | null; binary?: boolean };

function readText(abs: string): Before {
  try {
    if (statSync(abs).size > MAX_TEXT) return { text: null, binary: true };
    const buf = readFileSync(abs);
    return buf.subarray(0, 8192).includes(0) ? { text: null, binary: true } : { text: buf.toString('utf8') };
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? { text: null } : { text: null, binary: true };
  }
}

// The runs of changed lines turning `before` into `now`.
export function hunksOf(before: string, now: string): ReviewHunk[] {
  const out: ReviewHunk[] = [];
  let line = 0;
  let open: ReviewHunk | null = null;
  for (const [mark, text] of fileDiff(before, now)) {
    if (mark === ' ') {
      open = null;
      line++;
      continue;
    }
    if (!open) out.push((open = { line: line + 1, del: [], add: [] }));
    if (mark === '-') open.del.push(text);
    else {
      open.add.push(text);
      line++;
    }
  }
  return out;
}

const same = (a: ReviewHunk, b: ReviewHunk) => a.del.join('\n') === b.del.join('\n') && a.add.join('\n') === b.add.join('\n');

// Hunk k of the card put back to the text before the turn in the current text, or null when the current text no longer holds it.
// Identical hunks are taken in order, skipping the ones already undone.
export function undoHunk(before: string, now: string, hunks: ReviewHunk[], k: number): string | null {
  const h = hunks[k];
  const nth = hunks.slice(0, k).filter((x) => x.state !== 'undone' && same(x, h)).length;
  const at = hunksOf(before, now).flatMap((x, i) => (same(x, h) ? [i] : []))[nth];
  return at === undefined ? null : revertBlock(before, now, at);
}

const MAX_LINES = 400;

// What is decided on a file: each hunk, or the file itself when it has none.
const marks = (f: ReviewFile): Array<{ state?: ReviewState }> => (f.hunks.length ? f.hunks : [f]);

function summary(files: ReviewFile[]) {
  const all = files.flatMap(marks);
  const kept = all.filter((m) => m.state === 'kept').length;
  const undone = all.filter((m) => m.state === 'undone').length;
  const parts = [];
  if (kept) parts.push(`Kept ${kept}`);
  if (undone) parts.push(kept ? `undid ${undone}` : `Undid ${undone}`);
  return parts.join(', ');
}

// Files Claude edits during a turn, kept as they were before the first edit so the user can keep or undo each change afterwards.
export class Review {
  private before = new Map<string, Before>();
  private saved = new Map<string, Map<string, string>>();
  private chain = Promise.resolve();

  constructor(private s: AgentSession) {}

  private rel(file: string) {
    const abs = path.resolve(this.s.cwd, file);
    return inside(abs, path.resolve(this.s.cwd)) ? path.relative(this.s.cwd, abs) : null;
  }

  // Called before an edit tool runs, so the first call for a file reads its text from before the turn.
  capture(file: string) {
    const rel = this.rel(file);
    if (!this.s.state.session.review || !rel || this.before.has(rel)) return;
    this.before.set(rel, readText(path.resolve(this.s.cwd, rel)));
  }

  finish() {
    const before = this.before;
    this.before = new Map();
    if (!this.s.state.session.review) return;
    const files: ReviewFile[] = [];
    const texts = new Map<string, string>();
    for (const [rel, b] of before) {
      const now = readText(path.resolve(this.s.cwd, rel));
      if (b.binary || now.binary) files.push({ path: rel, hunks: [], binary: true });
      else if (now.text === null) continue;
      else if (b.text === null) {
        files.push({ path: rel, hunks: [], created: true });
        texts.set(rel, now.text);
      } else if (b.text !== now.text) {
        const hunks = hunksOf(b.text, now.text);
        // A change too large to show line by line is kept or reviewed in Changes.
        if (hunks.reduce((n, h) => n + h.del.length + h.add.length, 0) > MAX_LINES) files.push({ path: rel, hunks: [], binary: true, large: true });
        else files.push(hunks.length ? { path: rel, hunks } : { path: rel, hunks, binary: true });
        texts.set(rel, b.text);
      }
    }
    if (!files.length) return;
    const id = randomUUID();
    this.saved.set(id, texts);
    for (const old of [...this.saved.keys()].slice(0, -KEPT_REVIEWS)) this.saved.delete(old);
    this.s.pushEvent({ id, kind: 'review', files, at: Date.now() });
  }

  // Keep or undo one hunk, one file (no hunk), or every change of the card (no file).
  act(id: string, action: 'keep' | 'undo', file?: string, hunk?: number) {
    this.chain = this.chain.then(() => this.apply(id, action, file, hunk)).catch((err) => this.s.system(`Could not ${action} the change: ${errText(err)}`, true));
  }

  private async apply(id: string, action: 'keep' | 'undo', file?: string, hunk?: number) {
    const ev = this.s.eventById(id);
    if (ev?.kind !== 'review') return;
    for (const f of ev.files) {
      if (file && f.path !== file) continue;
      for (const [k, m] of marks(f).entries()) {
        if (m.state || (hunk !== undefined && hunk !== k)) continue;
        if (action === 'undo' && !(await this.undo(f, k, this.saved.get(id)?.get(f.path)))) continue;
        m.state = action === 'keep' ? 'kept' : 'undone';
      }
    }
    if (ev.files.every((f) => marks(f).every((m) => m.state))) ev.result = summary(ev.files);
    this.s.emit({ type: 'event', event: ev });
  }

  // For a created file `text` is what Claude left in it, for any other file what it was before the turn.
  private async undo(f: ReviewFile, k: number, text?: string) {
    if (f.binary) return false;
    if (text === undefined) return this.refuse(NO_TEXT);
    const abs = safeResolve(this.s.cwd, f.path);
    const now = await readFile(abs, 'utf8').catch(() => null);
    if (f.created) {
      if (now !== text) return this.refuse(STALE);
      await rm(abs, { force: true });
      return true;
    }
    const back = now === null ? null : undoHunk(text, now, f.hunks, k);
    if (back === null) return this.refuse(STALE);
    await writeFileText(this.s.cwd, f.path, back);
    return true;
  }

  private refuse(why: string) {
    this.s.system(why, true);
    return false;
  }
}
