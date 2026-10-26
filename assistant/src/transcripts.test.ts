import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from './db.js';
import { applyChanges } from './sync.js';
import { TRIES, actionId, dueMeetings, expireSuggested, markTried, readSaved, saveNotes } from './transcripts.js';

const MIN = 60_000;
const now = Date.parse('2026-10-26T16:00:00Z');
const meeting = (id: string, endedAgo: number, fields: Record<string, string> = {}) => ({
  table: 'meetings', id, profile: 'work' as const, updated_at: 1,
  fields: { title: id, starts_at: now - endedAgo - 30 * MIN, ends_at: now - endedAgo, ...fields },
});

describe('transcripts', () => {
  it('picks unprocessed calendar meetings that ended in the last days, a few times', () => {
    const db = openDb(':memory:');
    applyChanges(db, [
      meeting('cal:just', 1 * MIN), meeting('cal:hours', 5 * 60 * MIN), meeting('cal:old', 4 * 24 * 60 * MIN),
      meeting('cal:later', -200 * MIN), meeting('cal:done', 5 * MIN, { summary: 'x' }), meeting('local', 5 * MIN),
      meeting('cal:early', 5 * MIN, { summary: 'x', transcript: 'waiting' }), meeting('cal:gone', 5 * MIN, { transcript: 'missing' }),
    ]);
    const due = dueMeetings(db, 'work', now);
    expect(due.map((m) => m.id)).toEqual(['cal:hours', 'cal:early', 'cal:just']);
    markTried(db, 'work', due, now, true);
    expect(dueMeetings(db, 'work', now + 5 * MIN)).toEqual([]);
    expect(db.prepare("SELECT transcript FROM meetings WHERE id = 'cal:just'").get()).toEqual({ transcript: null });
    for (let i = 1; i <= TRIES; i++) {
      expect(dueMeetings(db, 'work', now + i * 15 * MIN)).toHaveLength(3);
      markTried(db, 'work', due, now + i * 15 * MIN);
    }
    expect(dueMeetings(db, 'work', now + 300 * MIN).map((m) => m.id)).toEqual(['cal:later']);
    expect(db.prepare("SELECT transcript, tries FROM meetings WHERE id = 'cal:just'").get()).toEqual({ transcript: 'missing', tries: TRIES });
  });

  it('saves the summary, sorts actions by owner and adds each once', () => {
    const db = openDb(':memory:');
    applyChanges(db, [meeting('cal:a', MIN, { notes: 'mine' }), meeting('cal:b', MIN), meeting('cal:c', -MIN)]);
    const n = (id: string) => ({
      id, summary: ' Done. ', doc_url: 'https://docs/x', room: 'Room 5',
      actions: [
        { title: 'Send the slides', context: 'Kim asked.', due: '2026-10-28T09:00:00Z', owner: 'me' as const },
        { title: 'Book the room', context: 'Said from the room.', due: null, owner: 'maybe' as const },
        { title: 'Write the FAQ', context: 'Nobody took it.', due: null, owner: 'nobody' as const },
      ],
      others: [{ who: 'Kim', what: 'Draft the post' }],
    });
    expect(saveNotes(db, 'work', [n('cal:a'), n('cal:b'), n('cal:gone')], now)).toBe(8);
    expect(db.prepare("SELECT id, summary, notes, transcript, room, others FROM meetings WHERE id IN ('cal:a', 'cal:b') ORDER BY id").all()).toEqual([
      { id: 'cal:a', summary: 'Done.', notes: 'mine', transcript: 'done', room: 'Room 5', others: '[{"who":"Kim","what":"Draft the post"}]' },
      { id: 'cal:b', summary: 'Done.', notes: null, transcript: 'done', room: 'Room 5', others: '[{"who":"Kim","what":"Draft the post"}]' },
    ]);
    const task = db.prepare('SELECT title, text, source, source_url, people, at, status, meeting_id FROM items WHERE id = ?').get(actionId('cal:a', 'Send the slides'));
    expect(task).toEqual({ title: 'Send the slides', text: 'Kim asked.', source: 'action', source_url: 'https://docs/x', people: 'cal:a', at: Date.parse('2026-10-28T09:00:00Z'), status: 'open', meeting_id: 'cal:a' });
    const status = (title: string) => (db.prepare('SELECT status FROM items WHERE id = ?').get(actionId('cal:a', title)) as { status: string }).status;
    expect([status('Book the room'), status('Write the FAQ')]).toEqual(['suggested', 'unassigned']);
    db.prepare("UPDATE items SET status = 'done' WHERE id = ?").run(actionId('cal:a', 'Send the slides'));
    const sure = { ...n('cal:a'), actions: n('cal:a').actions.map((a) => ({ ...a, owner: 'me' as const })) };
    saveNotes(db, 'work', [sure], now + MIN);
    expect([status('Send the slides'), status('Book the room'), status('Write the FAQ')]).toEqual(['done', 'open', 'open']);
    saveNotes(db, 'work', [n('cal:c')], now);
    expect(db.prepare("SELECT transcript FROM meetings WHERE id = 'cal:c'").get()).toEqual({ transcript: 'waiting' });
  });

  it('moves suggested actions left for a week to unassigned', () => {
    const db = openDb(':memory:');
    const item = (id: string, at: number) => ({ table: 'items', id, profile: 'work' as const, updated_at: at, fields: { title: id, status: 'suggested' } });
    applyChanges(db, [item('old', now - 8 * 24 * 60 * MIN), item('new', now - 60 * MIN)]);
    expect(expireSuggested(db, now)).toBe(1);
    expect(db.prepare('SELECT id, status FROM items ORDER BY id').all()).toEqual([{ id: 'new', status: 'suggested' }, { id: 'old', status: 'unassigned' }]);
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
