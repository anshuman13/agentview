import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Review, STALE, hunksOf, undoHunk } from './review';

const before = 'a\nb\nc\nd\ne\n';
const now = 'a\nB\nc\nd\nE\nf\n';

describe('hunksOf', () => {
  it('lists the runs of changed lines with their line in the new text', () => {
    expect(hunksOf(before, now)).toEqual([
      { line: 2, del: ['b'], add: ['B'] },
      { line: 5, del: ['e'], add: ['E', 'f'] },
    ]);
  });
});

describe('undoHunk', () => {
  it('puts back one hunk and leaves the other', () => {
    expect(undoHunk(before, now, hunksOf(before, now), 0)).toBe('a\nb\nc\nd\nE\nf\n');
  });

  it('finds the hunk after another one was undone', () => {
    const hunks = hunksOf(before, now);
    const left = undoHunk(before, now, hunks, 0)!;
    hunks[0].state = 'undone';
    expect(undoHunk(before, left, hunks, 1)).toBe(before);
  });

  it('returns null when the file was edited since', () => {
    expect(undoHunk(before, 'a\nBB\nc\nd\nE\nf\n', hunksOf(before, now), 0)).toBeNull();
  });

  it('takes identical hunks in order', () => {
    const a = 'x\nQ\nx\nQ\nx\n';
    const b = 'x\nZ\nx\nZ\nx\n';
    expect(undoHunk(a, b, hunksOf(a, b), 1)).toBe('x\nZ\nx\nQ\nx\n');
  });

  it('skips an identical hunk that was undone', () => {
    const a = 'x\nQ\nx\nQ\nx\n';
    const b = 'x\nZ\nx\nZ\nx\n';
    const hunks = hunksOf(a, b);
    const left = undoHunk(a, b, hunks, 0)!;
    hunks[0].state = 'undone';
    expect(undoHunk(a, left, hunks, 1)).toBe(a);
  });
});

describe('Review undo of a created file', () => {
  const run = async (edit: boolean) => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'review-'));
    const events: any[] = [];
    const said: string[] = [];
    const s: any = { cwd, state: { session: { review: true } }, pushEvent: (e: any) => events.push(e), eventById: (id: string) => events.find((e) => e.id === id), emit() {}, system: (t: string) => said.push(t) };
    const review = new Review(s);
    review.capture(path.join(cwd, 'new.txt'));
    writeFileSync(path.join(cwd, 'new.txt'), 'x');
    review.finish();
    if (edit) writeFileSync(path.join(cwd, 'new.txt'), 'x and more');
    review.act(events[0].id, 'undo', 'new.txt');
    await (review as any).chain;
    return { gone: !existsSync(path.join(cwd, 'new.txt')), said };
  };

  it('deletes the file Claude left', async () => {
    expect((await run(false)).gone).toBe(true);
  });

  it('keeps a file written to since', async () => {
    expect(await run(true)).toEqual({ gone: false, said: [STALE] });
  });
});
