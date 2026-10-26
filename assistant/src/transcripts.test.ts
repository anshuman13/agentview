import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from './db.js';
import { applyChanges } from './sync.js';
import { dueMeetings, markTried, readSaved, saveNotes } from './transcripts.js';

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

  it('saves summary and decisions and keeps notes I wrote', () => {
    const db = openDb(':memory:');
    applyChanges(db, [meeting('cal:a', MIN), meeting('cal:b', MIN, { notes: 'mine' })]);
    const n = (id: string) => ({ id, summary: ' Done. ', decisions: ['Ship it'], notes: '- from Gemini' });
    expect(saveNotes(db, 'work', [n('cal:a'), n('cal:b'), n('cal:gone')], now)).toBe(2);
    expect(db.prepare('SELECT id, summary, decisions, notes FROM meetings ORDER BY id').all()).toEqual([
      { id: 'cal:a', summary: 'Done.', decisions: '["Ship it"]', notes: '- from Gemini' },
      { id: 'cal:b', summary: 'Done.', decisions: '["Ship it"]', notes: 'mine' },
    ]);
  });

  it('lets notes typed on a device that has not synced win over imported notes', () => {
    const db = openDb(':memory:');
    applyChanges(db, [meeting('cal:a', MIN)]);
    saveNotes(db, 'work', [{ id: 'cal:a', summary: 'Done.', decisions: [], notes: '- from Gemini' }], now);
    applyChanges(db, [{ table: 'meetings', id: 'cal:a', profile: 'work', updated_at: now - MIN, fields: { notes: 'typed' } }]);
    expect(db.prepare('SELECT summary, notes FROM meetings').get()).toEqual({ summary: 'Done.', notes: 'typed' });
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
