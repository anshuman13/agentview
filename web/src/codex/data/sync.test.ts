import { describe, it, expect } from 'vitest';
import { FIELDS, rowToChange, mergeIncoming, type Change, type ItemRow, type PulledChange } from './sync';
import { runSync } from './engine';

const empty = Object.fromEntries(FIELDS.map((f) => [f, null]));

function localRow(over: Record<string, unknown> = {}) {
  return { id: 'id1', profile: 'work', version: 1, updated_at: 1000, deleted: 0, dirty: 0, field_times: '{}', ...empty, ...over } as ItemRow;
}

function hubChange(over: Record<string, unknown> = {}, fields: Record<string, unknown> = {}) {
  return {
    table: 'items',
    id: 'id1',
    profile: 'work',
    deleted: false,
    updated_at: 1000,
    version: 2,
    field_times: {},
    ...over,
    fields: { ...empty, ...fields },
  } as PulledChange;
}

describe('rowToChange', () => {
  it('sends only fields with a local field time', () => {
    const row = localRow({ title: 'Task', text: 'Body', status: 'open', field_times: '{"title":900,"status":950}' });
    expect(rowToChange(row)).toEqual({
      table: 'items',
      id: 'id1',
      profile: 'work',
      updated_at: 1000,
      fields: { title: 'Task', status: 'open' },
      field_times: { title: 900, status: 950 },
    });
  });

  it('omits deleted unless its field time is set', () => {
    expect(rowToChange(localRow({ deleted: 1, field_times: '{"title":900}' }))).not.toHaveProperty('deleted');
    expect(rowToChange(localRow({ deleted: 0 }))).not.toHaveProperty('deleted');
  });

  it('sends deleted with its own time as updated_at', () => {
    const change = rowToChange(localRow({ deleted: 1, updated_at: 3000, field_times: '{"deleted":2000,"title":3000}' }));
    expect(change.deleted).toBe(true);
    expect(change.updated_at).toBe(2000);
    expect(change.field_times).toEqual({ title: 3000 });
  });

  it('accepts field_times as an object', () => {
    expect(rowToChange(localRow({ title: 'T', field_times: { title: 900 } })).fields).toEqual({ title: 'T' });
  });
});

describe('mergeIncoming', () => {
  it('reads values from the nested fields object', () => {
    const merged = mergeIncoming(null, hubChange({ field_times: { title: 1000, status: 1000 } }, { title: 'New', status: 'open', people: 'Ola' }));
    expect(merged.title).toBe('New');
    expect(merged.status).toBe('open');
    expect(merged.people).toBe('Ola');
    expect(merged.deleted).toBe(0);
    expect(merged.version).toBe(2);
    expect(merged.dirty).toBe(0);
  });

  it('takes incoming field when newer', () => {
    const merged = mergeIncoming(
      localRow({ title: 'Old', field_times: '{"title":900}' }),
      hubChange({ updated_at: 2000, field_times: { title: 1500 } }, { title: 'New' }),
    );
    expect(merged.title).toBe('New');
    expect(merged.field_times.title).toBe(1500);
    expect(merged.dirty).toBe(0);
  });

  it('keeps local field when newer and marks dirty', () => {
    const merged = mergeIncoming(
      localRow({ title: 'Local', updated_at: 2000, field_times: '{"title":1500}' }),
      hubChange({ field_times: { title: 900 } }, { title: 'Hub' }),
    );
    expect(merged.title).toBe('Local');
    expect(merged.field_times.title).toBe(1500);
    expect(merged.dirty).toBe(1);
  });

  it('keeps local on a tie without marking dirty', () => {
    const merged = mergeIncoming(
      localRow({ title: 'Local', field_times: '{"title":1000}' }),
      hubChange({ field_times: { title: 1000 } }, { title: 'Hub' }),
    );
    expect(merged.title).toBe('Local');
    expect(merged.dirty).toBe(0);
  });

  it('keeps an existing dirty flag', () => {
    const merged = mergeIncoming(localRow({ dirty: 1, field_times: '{"title":1000}' }), hubChange({ field_times: { title: 1000 } }));
    expect(merged.dirty).toBe(1);
  });

  it('merges each field on its own time', () => {
    const merged = mergeIncoming(
      localRow({ title: 'Local title', text: 'Local text', updated_at: 2000, field_times: '{"title":2000,"text":1500}' }),
      hubChange({ updated_at: 1800, field_times: { title: 1800, text: 1800, status: 1800 } }, { title: 'Hub title', text: 'Hub text', status: 'open' }),
    );
    expect(merged.title).toBe('Local title');
    expect(merged.text).toBe('Hub text');
    expect(merged.status).toBe('open');
    expect(merged.field_times).toEqual({ title: 2000, text: 1800, status: 1800, source: 1800, source_url: 1800, people: 1800, at: 1800, meeting_id: 1800 });
    expect(merged.dirty).toBe(1);
  });

  it('falls back to incoming updated_at for missing field times', () => {
    const merged = mergeIncoming(null, hubChange({ updated_at: 1500 }, { title: 'Task' }));
    expect(merged.field_times.title).toBe(1500);
  });

  it('sets updated_at to the max of local and incoming', () => {
    const local = localRow({ updated_at: 3000, field_times: '{"title":3000}' });
    expect(mergeIncoming(local, hubChange({ updated_at: 1500 })).updated_at).toBe(3000);
    expect(mergeIncoming(local, hubChange({ updated_at: 4000 })).updated_at).toBe(4000);
  });

  it('keeps a newer local delete', () => {
    const merged = mergeIncoming(localRow({ deleted: 1, field_times: '{"deleted":1500}' }), hubChange({ updated_at: 1000 }));
    expect(merged.deleted).toBe(1);
    expect(merged.field_times.deleted).toBe(1500);
    expect(merged.dirty).toBe(1);
  });

  it('takes a newer hub undelete', () => {
    const merged = mergeIncoming(
      localRow({ deleted: 1, field_times: '{"deleted":1500}' }),
      hubChange({ updated_at: 2000, deleted: false, field_times: { deleted: 2000 } }),
    );
    expect(merged.deleted).toBe(0);
    expect(merged.field_times.deleted).toBe(2000);
    expect(merged.dirty).toBe(0);
  });

  it('takes a newer hub delete', () => {
    const merged = mergeIncoming(localRow(), hubChange({ deleted: true, field_times: { deleted: 1200 } }));
    expect(merged.deleted).toBe(1);
  });
});

describe('wiki tables', () => {
  const fact = { id: 'f1', profile: 'work' as const, version: 0, updated_at: 2000, deleted: 0, dirty: 1, field_times: '{"contested":2000}', text: 'Budgets reset monthly', contested: '{"by":"you"}' };

  it('sends only the timed fields of a wiki row with its table', () => {
    expect(rowToChange(fact, 'facts')).toEqual({ table: 'facts', id: 'f1', profile: 'work', updated_at: 2000, fields: { contested: '{"by":"you"}' }, field_times: { contested: 2000 } });
  });

  it('merges a pulled wiki row on the fields of its table', () => {
    const change: PulledChange = { table: 'facts', id: 'f1', profile: 'work', version: 7, deleted: false, updated_at: 1500, fields: { text: 'Budgets reset weekly', contested: null, page_id: 'p1' }, field_times: { text: 1500, contested: 1500, page_id: 1500 } };
    const merged = mergeIncoming<typeof fact>(fact, change) as unknown as Record<string, unknown>;
    expect(merged).toMatchObject({ text: 'Budgets reset weekly', contested: '{"by":"you"}', page_id: 'p1', version: 7, dirty: 1 });
    expect(merged).not.toHaveProperty('title');
  });

  it('pushes rows from every table and applies known tables only', async () => {
    const posted: Change[] = [];
    const applied: string[] = [];
    await runSync({
      active: () => true,
      since: async () => 0,
      saveSince: async () => {},
      dirty: async () => [{ table: 'facts', row: fact }],
      post: async (_since, changes) => {
        posted.push(...changes);
        const base = { profile: 'work' as const, version: 1, deleted: false, updated_at: 1, fields: {}, field_times: {} };
        return { version: 1, changes: [{ ...base, table: 'pages', id: 'p1' }, { ...base, table: 'secrets', id: 's1' }] };
      },
      clean: async () => {},
      apply: async (c) => void applied.push(c.table),
    });
    expect(posted.map((c) => c.table)).toEqual(['facts']);
    expect(applied).toEqual(['pages']);
  });
});
