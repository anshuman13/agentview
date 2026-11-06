import { expect, it } from 'vitest';
import { normaliseNote, planNoteWrite, wrapNoteId, wrapNoteProfile } from './wrapNote';
import type { Brief } from './wiki';

const now = new Date(2026, 10, 6, 17, 30).getTime();
const base: Brief = { id: 'wrapup:2026-11-06', profile: 'work', version: 1, updated_at: now, deleted: 0, field_times: '{}', dirty: 0, kind: 'wrapup', text: 'start with the invoice', from_at: new Date(2026, 10, 6).getTime(), to_at: now };

it('uses the local date and work for All', () => {
  expect(wrapNoteId(now)).toBe('wrapup:2026-11-06');
  expect(wrapNoteProfile('all')).toBe('work');
  expect(wrapNoteProfile('personal')).toBe('personal');
});

it('normalises the note', () => {
  expect(normaliseNote('  a \n  b\t c ')).toBe('a b c');
  expect(normaliseNote('x'.repeat(300))).toHaveLength(200);
  expect(normaliseNote(' \n ')).toBe('');
});

it('creates, updates and never duplicates', () => {
  const w = planNoteWrite(undefined, 'start with the invoice', 'work', now)!;
  expect(w.row).toMatchObject({ id: 'wrapup:2026-11-06', profile: 'work', kind: 'wrapup', dirty: 1, deleted: 0, from_at: new Date(2026, 10, 6).getTime() });
  expect(w.patch).toEqual({ kind: 'wrapup', text: 'start with the invoice', from_at: w.row.from_at, to_at: now });
  expect(planNoteWrite(base, ' start with the  invoice ', 'work', now)).toBeNull();
  const c = planNoteWrite(base, 'call Sam', 'work', now + 1)!;
  expect(c.row).toBe(base);
  expect(c.patch).toEqual({ text: 'call Sam', to_at: now + 1, deleted: 0 });
  expect(planNoteWrite({ ...base, ...c.patch } as Brief, 'call Sam', 'work', now + 2)).toBeNull();
});

it('deletes on empty and undeletes on typing', () => {
  expect(planNoteWrite(base, '  ', 'work', now)!.patch).toEqual({ deleted: 1 });
  expect(planNoteWrite(undefined, '', 'work', now)).toBeNull();
  const gone = { ...base, deleted: 1 };
  expect(planNoteWrite(gone, '', 'work', now)).toBeNull();
  expect(planNoteWrite(gone, 'again', 'work', now)!.patch).toMatchObject({ deleted: 0, text: 'again' });
});
