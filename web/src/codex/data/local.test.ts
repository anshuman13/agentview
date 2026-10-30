import { describe, expect, it } from 'vitest';
import { edited, moved, newCapture } from './engine';
import { captureParams, patchSQL, swapSQL } from './localRows';
import { TABLE_FIELDS, type ItemRow } from './sync';

const times = (r: { field_times: string }) => JSON.parse(r.field_times);
const row = (over: Partial<ItemRow> = {}): ItemRow => ({ ...newCapture('Call the bank', 'task', 'work', 1000), ...over });

describe('newCapture', () => {
  it('splits the first line into the title and the rest into the text', () => {
    const r = newCapture('Title\n\n  body line 1\nline 2 \n', 'task', 'personal', 1000);
    expect(r).toMatchObject({ title: 'Title', text: 'body line 1\nline 2', profile: 'personal', status: 'open', source: 'capture', dirty: 1, version: 0, deleted: 0, updated_at: 1000 });
  });

  it('truncates the title to 120 characters and leaves empty text null', () => {
    const r = newCapture('x'.repeat(200), 'note', 'work', 1000);
    expect(r.title).toHaveLength(120);
    expect(r.text).toBeNull();
    expect(r.status).toBe('note');
  });

  it('times only the fields it sets, and at only when given', () => {
    expect(Object.keys(times(row())).sort()).toEqual(['source', 'status', 'text', 'title']);
    expect(times(row({ ...newCapture('a', 'task', 'work', 7, 99) })).at).toBe(7);
  });

  it('labels a meeting action with the meeting title', () => {
    const r = newCapture('Follow up', 'task', 'work', 5, null, { id: 'm1', title: 'Sync' });
    expect(r).toMatchObject({ source: 'action', people: 'Sync', meeting_id: 'm1' });
    expect(times(r)).toMatchObject({ people: 5, meeting_id: 5 });
  });
});

describe('edited', () => {
  it('times only the patched fields and marks the row dirty', () => {
    const base = edited(row(), {}, 1000);
    const r = edited({ ...base, dirty: 0 }, { status: 'done' }, 3000);
    expect(times(r)).toMatchObject({ title: 1000, text: 1000, status: 3000 });
    expect(r).toMatchObject({ status: 'done', title: 'Call the bank', updated_at: 3000, dirty: 1 });
  });

  it('keeps an empty patch from moving any field time', () => {
    const r = row();
    const e = edited(r, {}, 9000);
    expect(times(e)).toEqual(times(r));
    expect(e.dirty).toBe(1);
  });

  it('never moves updated_at backwards', () => {
    expect(edited(row({ updated_at: 5000 }), { title: 'x' }, 2000).updated_at).toBe(5000);
  });

  it('starts from empty times when field_times is damaged', () => {
    expect(times(edited(row({ field_times: 'nope' }), { rank: 1 }, 4000))).toEqual({ rank: 4000 });
  });
});

describe('patchSQL', () => {
  it('returns null for an empty patch and for unknown keys', () => {
    expect(patchSQL({})).toBeNull();
    expect(patchSQL({ id: 'x' } as never)).toBeNull();
  });

  it('sets values and field times in patchable order', () => {
    const p = patchSQL({ status: 'done', title: 'New' })!;
    expect(p.sql).toBe("title = ?, status = ?, field_times = json_set(field_times, '$.title', ?, '$.status', ?)");
    expect(p.params(500)).toEqual(['New', 'done', 500, 500]);
  });

  it('writes null for an undefined value and times deleted', () => {
    const p = patchSQL({ at: undefined, deleted: 1 })!;
    expect(p.params(7)).toEqual([null, 1, 7, 7]);
    expect(p.sql).toContain("'$.deleted', ?");
  });

  it('clears the meeting link', () => {
    expect(patchSQL({ meeting_id: null })!.sql).toBe("meeting_id = ?, field_times = json_set(field_times, '$.meeting_id', ?)");
  });
});

describe('swapSQL', () => {
  const cols = ['version', 'updated_at', 'deleted', 'field_times', ...TABLE_FIELDS.items, 'dirty'];

  it('inserts with INSERT OR IGNORE when there is no local row', () => {
    const r = row();
    const { sql, params } = swapSQL('items', r, undefined);
    expect(sql.startsWith('INSERT OR IGNORE INTO items')).toBe(true);
    expect(sql.match(/\?/g)).toHaveLength(cols.length + 2);
    expect(params).toHaveLength(cols.length + 2);
    expect(params.slice(-2)).toEqual([r.profile, r.id]);
  });

  it('updates guarded by the local updated_at and field_times', () => {
    const local = row({ updated_at: 10, field_times: '{"title":10}' });
    const next = edited(local, { title: 'New' }, 20);
    const { sql, params } = swapSQL('items', next, local);
    expect(sql).toMatch(/^UPDATE items SET version = \?.* WHERE profile = \? AND id = \? AND updated_at = \? AND field_times = \?$/);
    expect(params.slice(-4)).toEqual([local.profile, local.id, 10, '{"title":10}']);
    expect(params[cols.indexOf('title')]).toBe('New');
    expect(params[cols.indexOf('updated_at')]).toBe(20);
  });

  it('turns missing fields into null and uses the table columns', () => {
    const { sql, params } = swapSQL('jobs', { id: 'j', profile: 'work', version: 1, updated_at: 3, deleted: 0, field_times: '{}', dirty: 0 }, undefined);
    expect(sql).toContain('INSERT OR IGNORE INTO jobs (version, updated_at, deleted, field_times, name, schedule, prompt, enabled, next_run_at, dirty, profile, id)');
    expect(params).toEqual([1, 3, 0, '{}', null, null, null, null, null, 0, 'work', 'j']);
  });
});

describe('captureParams', () => {
  it('lists capture values in insert column order', () => {
    const r = newCapture('T\nB', 'task', 'work', 1000, 50, { id: 'm', title: 'Sync' });
    expect(captureParams(r)).toEqual([r.id, 'work', 1000, r.field_times, 'T', 'B', 'action', 'Sync', 50, 'open', 'm']);
  });
});
