import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from './db.js';
import { applyChanges } from './sync.js';
import { docReader, readSaved } from './transcriptDocs.js';
import { TRIES, actionId, dueAt, dueMeetings, expireSuggested, markTried, saveNotes, saveTranscripts, searchTranscripts, transcriptText } from './transcripts.js';

const MIN = 60_000;
const tempRoot = () => {
  fs.mkdirSync(process.env.AGENTVIEW_LIMITS_DIR!, { recursive: true });
  return fs.mkdtempSync(path.join(process.env.AGENTVIEW_LIMITS_DIR!, 'tx-'));
};
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
    const root = tempRoot();
    const dir = path.join(root, 'projects', 'p', 's', 'tool-results');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'out.txt'), JSON.stringify({ fileContent: 'x'.repeat(40_000) }));
    fs.writeFileSync(path.join(root, 'secret.txt'), 'no');
    expect(readSaved(root, path.join(dir, 'out.txt'), 30_000)).toBe(`${'x'.repeat(10_000)}\n[characters 30000-40000 of 40000]`);
    expect(() => readSaved(root, path.join(root, 'secret.txt'))).toThrow('Only saved tool outputs');
    expect(() => readSaved(root, path.join(dir, '..', '..', '..', '..', 'secret.txt'))).toThrow('Only saved tool outputs');
  });

  it('takes each doc read from the stream, and a saved output whole', () => {
    const root = tempRoot();
    const dir = path.join(root, 'projects', 'p', 's', 'tool-results');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'mcp-out.txt');
    fs.writeFileSync(file, JSON.stringify([{ type: 'text', text: JSON.stringify({ fileContent: 'Kim: the long one' }) }]));
    const a = 'A'.repeat(30), b = 'B'.repeat(30);
    const use = (id: string, name: string, input: object) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
    const result = (id: string, content: unknown, is_error = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } });
    const docs = docReader(root);
    [
      use('1', 'mcp__claude_ai_Google_Drive__read_file_content', { fileId: a }),
      result('1', [{ type: 'text', text: JSON.stringify({ fileContent: 'Ola: short' }) }]),
      use('2', 'mcp__claude_ai_Google_Docs__read_doc', { documentId: `https://docs.google.com/document/d/${b}/edit` }),
      result('2', `<persisted-output>\nOutput too large. Full output saved to: ${file}\n\nPreview: Kim: the</persisted-output>`),
      use('3', 'mcp__claude_ai_Google_Calendar__get_event', { eventId: 'C'.repeat(30) }),
      result('3', 'event'),
      use('4', 'mcp__claude_ai_Google_Drive__read_file_content', { fileId: a }),
      result('4', 'failed', true),
    ].forEach(docs.see);
    expect(docs.textFor(`https://docs.google.com/document/d/${a}/edit`, false)).toEqual({ doc: a, text: 'Ola: short' });
    expect(docs.textFor(`https://docs.google.com/document/d/${b}`, false)).toEqual({ doc: b, text: 'Kim: the long one' });
    expect(docs.textFor('https://docs/unknown', true)).toBeNull();
    const one = docReader(root);
    [use('1', 'read_file_content', { fileId: a }), result('1', 'Ola: hi')].forEach(one.see);
    expect(one.textFor('', true)).toEqual({ doc: a, text: 'Ola: hi' });
    expect(one.textFor('', false)).toBeNull();
  });

  it('finds meetings by every word of their transcript', () => {
    const db = openDb(':memory:');
    applyChanges(db, [meeting('cal:a', 60 * MIN), meeting('cal:b', MIN), meeting('cal:gone', MIN)]);
    applyChanges(db, [{ table: 'meetings', id: 'cal:gone', profile: 'work', updated_at: 2, deleted: true, fields: {} }]);
    const long = `${'Intro. '.repeat(20)}Øystein: we ship the Rollout on friday. ${'Outro. '.repeat(20)}`;
    saveTranscripts(db, 'work', [{ id: 'cal:a', doc: 'd1', text: long }, { id: 'cal:b', doc: 'd2', text: 'Kim: rollout later' }, { id: 'cal:gone', doc: 'd3', text: 'rollout' }], now);
    expect(searchTranscripts(db, 'ROLLOUT').map((h) => h.id)).toEqual(['cal:b', 'cal:a']);
    const [hit] = searchTranscripts(db, 'øystein friday');
    expect(hit.id).toBe('cal:a');
    expect(hit.snippet).toMatch(/^\.\.\..*Øystein: we ship the Rollout on friday.*\.\.\.$/);
    expect(searchTranscripts(db, 'rollout nothing')).toEqual([]);
    expect(searchTranscripts(db, '"Rollout," friday?').map((h) => h.id)).toEqual(['cal:a']);
    applyChanges(db, [{ ...meeting('cal:p', 0), profile: 'personal' }]);
    saveTranscripts(db, 'personal', [{ id: 'cal:p', doc: 'd4', text: 'rollout at home' }], now);
    expect(searchTranscripts(db, 'rollout', 'work').map((h) => h.id)).toEqual(['cal:b', 'cal:a']);
    expect(searchTranscripts(db, 'rollout', 'personal').map((h) => h.id)).toEqual(['cal:p']);
    expect(transcriptText(db, 'work', 'cal:b')).toBe('Kim: rollout later');
    expect(transcriptText(db, 'personal', 'cal:b')).toBeNull();
  });
});

describe('dueAt', () => {
  it('puts a bare day on its local morning and keeps a clock time', () => {
    expect(dueAt('2026-10-28')).toBe(new Date(2026, 9, 28, 9).getTime());
    expect(dueAt('2026-10-27T08:00:00')).toBe(new Date(2026, 9, 27, 8).getTime());
    expect(dueAt(null)).toBeNaN();
  });
});
