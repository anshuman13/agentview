import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from './db.js';
import { applyChanges } from './sync.js';
import { actionId, dueMeetings, markTried, readSaved, saveNotes } from './transcripts.js';

const MIN = 60_000;
const now = Date.parse('2026-10-26T16:00:00Z');
const meeting = (id: string, endedAgo: number, fields: Record<string, string> = {}) => ({
  table: 'meetings', id, profile: 'work' as const, updated_at: 1,
  fields: { title: id, starts_at: now - endedAgo - 30 * MIN, ends_at: now - endedAgo, ...fields },
});

describe('transcripts', () => {
  it('picks calendar meetings without a summary that ended in the last day, a few times', () => {
    const db = openDb(':memory:');
    applyChanges(db, [
      meeting('cal:just', 1 * MIN), meeting('cal:hours', 5 * 60 * MIN), meeting('cal:old', 25 * 60 * MIN),
      meeting('cal:later', -200 * MIN), meeting('cal:done', 5 * MIN, { summary: 'x' }), meeting('local', 5 * MIN),
    ]);
    const due = dueMeetings(db, 'work', now);
    expect(due.map((m) => m.id)).toEqual(['cal:hours', 'cal:just']);
    markTried(db, 'work', due, now);
    expect(dueMeetings(db, 'work', now + 5 * MIN)).toEqual([]);
    for (let i = 1; i < 4; i++) {
      expect(dueMeetings(db, 'work', now + i * 20 * MIN)).toHaveLength(2);
      markTried(db, 'work', due, now + i * 20 * MIN);
    }
    expect(dueMeetings(db, 'work', now + 120 * MIN)).toEqual([]);
  });

  it('saves only the summary and adds my actions once', () => {
    const db = openDb(':memory:');
    applyChanges(db, [meeting('cal:a', MIN, { notes: 'mine' }), meeting('cal:b', MIN)]);
    const n = (id: string) => ({ id, summary: ' Done. ', doc_url: 'https://docs/x', actions: [{ title: 'Send the slides', context: 'Kim asked.', due: '2026-10-28T09:00:00Z', sure: true }, { title: 'Book the room', context: 'Said from the room.', due: null, sure: false }] });
    expect(saveNotes(db, 'work', [n('cal:a'), n('cal:b'), n('cal:gone')], now)).toBe(6);
    expect(db.prepare('SELECT id, summary, notes FROM meetings ORDER BY id').all()).toEqual([
      { id: 'cal:a', summary: 'Done.', notes: 'mine' },
      { id: 'cal:b', summary: 'Done.', notes: null },
    ]);
    const task = db.prepare('SELECT title, text, source, source_url, people, at, status, meeting_id FROM items WHERE id = ?').get(actionId('cal:a', 'Send the slides'));
    expect(task).toEqual({ title: 'Send the slides', text: 'Kim asked.', source: 'action', source_url: 'https://docs/x', people: 'cal:a', at: Date.parse('2026-10-28T09:00:00Z'), status: 'open', meeting_id: 'cal:a' });
    expect(db.prepare('SELECT status FROM items WHERE id = ?').get(actionId('cal:a', 'Book the room'))).toEqual({ status: 'suggested' });
    db.prepare("UPDATE items SET status = 'done'").run();
    expect(saveNotes(db, 'work', [n('cal:a')], now + MIN)).toBe(1);
    expect(db.prepare("SELECT count(*) n FROM items WHERE status = 'open'").get()).toEqual({ n: 0 });
  });

  it('reads saved tool outputs in chunks and nothing else', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-'));
    const dir = path.join(root, 'projects', 'p', 's', 'tool-results');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'out.txt'), JSON.stringify({ fileContent: 'x'.repeat(40_000) }));
    fs.writeFileSync(path.join(root, 'secret.txt'), 'no');
    expect(readSaved(root, path.join(dir, 'out.txt'), 30_000)).toBe(`${'x'.repeat(10_000)}\n[characters 30000-40000 of 40000]`);
    expect(() => readSaved(root, path.join(root, 'secret.txt'))).toThrow('Only saved tool outputs');
    expect(() => readSaved(root, path.join(dir, '..', '..', '..', '..', 'secret.txt'))).toThrow('Only saved tool outputs');
  });
});
