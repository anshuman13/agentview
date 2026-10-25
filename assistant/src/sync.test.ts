import { describe, it, expect, beforeEach } from 'bun:test';
import { applyChanges, pullChanges } from './sync.js';
import { openDb, TABLES } from './db.js';
import { Database } from 'bun:sqlite';
import fs from 'fs';
import os from 'os';

let db: ReturnType<typeof openDb>;

beforeEach(() => {
  db = openDb(':memory:');
});

describe('sync', () => {
  it('insert then pull', () => {
    const changes = [
      {
        table: 'items',
        id: 'item1',
        profile: 'work' as const,
        updated_at: 1000,
        fields: { title: 'Item 1', text: 'Description' },
      },
    ];

    const applied = applyChanges(db, changes);
    expect(applied.applied).toBe(1);
    expect(applied.version).toBeGreaterThan(0);

    const pulled = pullChanges(db, 0);
    expect(pulled.changes.length).toBe(1);
    expect(pulled.changes[0].id).toBe('item1');
    expect(pulled.changes[0].fields.title).toBe('Item 1');
    expect(pulled.changes[0].fields.text).toBe('Description');
  });

  it('newer field edit wins', () => {
    const change1 = {
      table: 'items',
      id: 'item1',
      profile: 'work' as const,
      updated_at: 1000,
      fields: { title: 'Old Title', text: 'Text 1' },
      field_times: { title: 1000, text: 1000 },
    };

    applyChanges(db, [change1]);

    const change2 = {
      table: 'items',
      id: 'item1',
      profile: 'work' as const,
      updated_at: 2000,
      fields: { title: 'New Title' },
      field_times: { title: 2000 },
    };

    applyChanges(db, [change2]);

    const pulled = pullChanges(db, 0);
    const item = pulled.changes.find((c) => c.id === 'item1');
    expect(item?.fields.title).toBe('New Title');
    expect(item?.fields.text).toBe('Text 1');
  });

  it('older field edit loses', () => {
    const change1 = {
      table: 'items',
      id: 'item1',
      profile: 'work' as const,
      updated_at: 2000,
      fields: { title: 'New Title' },
      field_times: { title: 2000 },
    };

    applyChanges(db, [change1]);

    const change2 = {
      table: 'items',
      id: 'item1',
      profile: 'work' as const,
      updated_at: 1000,
      fields: { title: 'Old Title' },
      field_times: { title: 1000 },
    };

    applyChanges(db, [change2]);

    const pulled = pullChanges(db, 0);
    const item = pulled.changes.find((c) => c.id === 'item1');
    expect(item?.fields.title).toBe('New Title');
  });

  it('per-field merge - two devices edit different fields', () => {
    const change1 = {
      table: 'items',
      id: 'item1',
      profile: 'work' as const,
      updated_at: 1000,
      fields: { title: 'Item 1', source: 'web' },
      field_times: { title: 1000, source: 1000 },
    };

    applyChanges(db, [change1]);

    const change2 = {
      table: 'items',
      id: 'item1',
      profile: 'work' as const,
      updated_at: 2000,
      fields: { text: 'A description' },
      field_times: { text: 2000 },
    };

    applyChanges(db, [change2]);

    const pulled = pullChanges(db, 0);
    const item = pulled.changes[pulled.changes.length - 1];
    expect(item.fields.title).toBe('Item 1');
    expect(item.fields.source).toBe('web');
    expect(item.fields.text).toBe('A description');
  });

  it('tie keeps stored value', () => {
    const change1 = {
      table: 'items',
      id: 'item1',
      profile: 'work' as const,
      updated_at: 1000,
      fields: { title: 'First' },
      field_times: { title: 1000 },
    };

    applyChanges(db, [change1]);

    const change2 = {
      table: 'items',
      id: 'item1',
      profile: 'work' as const,
      updated_at: 1000,
      fields: { title: 'Second' },
      field_times: { title: 1000 },
    };

    applyChanges(db, [change2]);

    const pulled = pullChanges(db, 0);
    const item = pulled.changes.find((c) => c.id === 'item1');
    expect(item?.fields.title).toBe('First');
  });

  it('unchanged apply does not bump version', () => {
    const change1 = {
      table: 'items',
      id: 'item1',
      profile: 'work' as const,
      updated_at: 1000,
      fields: { title: 'Item 1' },
      field_times: { title: 1000 },
    };

    applyChanges(db, [change1]);
    const pulled1 = pullChanges(db, 0);
    const version1 = pulled1.version;

    const change2 = {
      table: 'items',
      id: 'item1',
      profile: 'work' as const,
      updated_at: 500,
      fields: { title: 'Old Value' },
      field_times: { title: 500 },
    };

    const result = applyChanges(db, [change2]);
    expect(result.applied).toBe(0);

    const pulled2 = pullChanges(db, 0);
    expect(pulled2.version).toBe(version1);
  });

  it('delete as last-write-wins', () => {
    const change1 = {
      table: 'items',
      id: 'item1',
      profile: 'work' as const,
      updated_at: 1000,
      fields: { title: 'Item 1' },
    };

    applyChanges(db, [change1]);

    const change2 = {
      table: 'items',
      id: 'item1',
      profile: 'work' as const,
      updated_at: 2000,
      fields: {},
      deleted: true,
    };

    applyChanges(db, [change2]);

    const pulled = pullChanges(db, 0);
    const item = pulled.changes.find((c) => c.id === 'item1');
    expect(item?.deleted).toBe(true);
  });

  it('newer edit after delete does not resurrect when delete is newer', () => {
    const change1 = {
      table: 'items',
      id: 'item1',
      profile: 'work' as const,
      updated_at: 1000,
      fields: { title: 'Item 1' },
    };

    applyChanges(db, [change1]);

    const change2 = {
      table: 'items',
      id: 'item1',
      profile: 'work' as const,
      updated_at: 3000,
      fields: {},
      deleted: true,
    };

    applyChanges(db, [change2]);

    const change3 = {
      table: 'items',
      id: 'item1',
      profile: 'work' as const,
      updated_at: 2000,
      fields: { title: 'Item 1 Updated' },
      field_times: { title: 2000 },
    };

    applyChanges(db, [change3]);

    const pulled = pullChanges(db, 0);
    const item = pulled.changes.find((c) => c.id === 'item1');
    expect(item?.deleted).toBe(true);
  });

  it('pull since N returns only newer', () => {
    const change1 = {
      table: 'items',
      id: 'item1',
      profile: 'work' as const,
      updated_at: 1000,
      fields: { title: 'Item 1' },
    };

    applyChanges(db, [change1]);
    const pulled1 = pullChanges(db, 0);
    const version1 = pulled1.changes[0].version;

    const change2 = {
      table: 'items',
      id: 'item2',
      profile: 'work' as const,
      updated_at: 2000,
      fields: { title: 'Item 2' },
    };

    applyChanges(db, [change2]);

    const pulled2 = pullChanges(db, version1);
    expect(pulled2.changes.length).toBe(1);
    expect(pulled2.changes[0].id).toBe('item2');
  });

  it('invalid table throws and applies nothing', () => {
    const changes = [
      {
        table: 'invalid_table',
        id: 'item1',
        profile: 'work' as const,
        updated_at: 1000,
        fields: { name: 'Item 1' },
      },
    ];

    expect(() => applyChanges(db, changes)).toThrow('Invalid table');

    const pulled = pullChanges(db, 0);
    expect(pulled.changes.length).toBe(0);
  });

  it('invalid field throws and applies nothing', () => {
    const changes = [
      {
        table: 'items',
        id: 'item1',
        profile: 'work' as const,
        updated_at: 1000,
        fields: { invalid_field: 'value' },
      },
    ];

    expect(() => applyChanges(db, changes)).toThrow('Invalid field');

    const pulled = pullChanges(db, 0);
    expect(pulled.changes.length).toBe(0);
  });

  it('invalid id throws and applies nothing', () => {
    const changes = [
      {
        table: 'items',
        id: '',
        profile: 'work' as const,
        updated_at: 1000,
        fields: { name: 'Item 1' },
      },
    ];

    expect(() => applyChanges(db, changes)).toThrow('Invalid id');

    const pulled = pullChanges(db, 0);
    expect(pulled.changes.length).toBe(0);
  });

  it('invalid profile throws and applies nothing', () => {
    const changes = [
      {
        table: 'items',
        id: 'item1',
        profile: 'invalid' as any,
        updated_at: 1000,
        fields: { name: 'Item 1' },
      },
    ];

    expect(() => applyChanges(db, changes)).toThrow('Invalid profile');

    const pulled = pullChanges(db, 0);
    expect(pulled.changes.length).toBe(0);
  });

  it('invalid value type throws and applies nothing', () => {
    const changes = [
      {
        table: 'items',
        id: 'item1',
        profile: 'work' as const,
        updated_at: 1000,
        fields: { title: { nested: 'object' } },
      },
    ];

    expect(() => applyChanges(db, changes)).toThrow('Invalid value type');

    const pulled = pullChanges(db, 0);
    expect(pulled.changes.length).toBe(0);
  });

  it('multiple changes in transaction', () => {
    const changes = [
      {
        table: 'items',
        id: 'item1',
        profile: 'work' as const,
        updated_at: 1000,
        fields: { title: 'Item 1' },
      },
      {
        table: 'items',
        id: 'item2',
        profile: 'work' as const,
        updated_at: 1000,
        fields: { title: 'Item 2' },
      },
    ];

    const result = applyChanges(db, changes);
    expect(result.applied).toBe(2);

    const pulled = pullChanges(db, 0);
    expect(pulled.changes.length).toBe(2);
  });

  it('same id in work and personal creates two rows', () => {
    const changeWork = {
      table: 'items',
      id: 'item1',
      profile: 'work' as const,
      updated_at: 1000,
      fields: { title: 'Work Item' },
    };

    const changePersonal = {
      table: 'items',
      id: 'item1',
      profile: 'personal' as const,
      updated_at: 1000,
      fields: { title: 'Personal Item' },
    };

    applyChanges(db, [changeWork]);
    applyChanges(db, [changePersonal]);

    const pulled = pullChanges(db, 0);
    expect(pulled.changes.length).toBe(2);
    const workItem = pulled.changes.find((c) => c.profile === 'work');
    const personalItem = pulled.changes.find((c) => c.profile === 'personal');
    expect(workItem?.fields.title).toBe('Work Item');
    expect(personalItem?.fields.title).toBe('Personal Item');
  });

  it('pulls all changes across tables with limit', () => {
    const changes = [
      {
        table: 'items',
        id: 'item1',
        profile: 'work' as const,
        updated_at: 1000,
        fields: { title: 'Item 1' },
      },
      {
        table: 'items',
        id: 'item2',
        profile: 'work' as const,
        updated_at: 2000,
        fields: { title: 'Item 2' },
      },
      {
        table: 'people',
        id: 'person1',
        profile: 'work' as const,
        updated_at: 3000,
        fields: { name: 'Person 1' },
      },
      {
        table: 'people',
        id: 'person2',
        profile: 'work' as const,
        updated_at: 4000,
        fields: { name: 'Person 2' },
      },
    ];

    applyChanges(db, changes);

    const pulled1 = pullChanges(db, 0, 2);
    expect(pulled1.changes.length).toBe(2);
    expect(pulled1.hasMore).toBe(true);
    const lastVersion = pulled1.version;

    const pulled2 = pullChanges(db, lastVersion, 2);
    expect(pulled2.changes.length).toBe(2);
    expect(pulled2.hasMore).toBe(false);

    const allChanges = [...pulled1.changes, ...pulled2.changes];
    expect(allChanges.length).toBe(4);
  });

  it('invalid table name throws', () => {
    expect(() => {
      applyChanges(db, [
        {
          table: 'toString',
          id: 'item1',
          profile: 'work' as const,
          updated_at: 1000,
          fields: {},
        },
      ]);
    }).toThrow('Invalid table');
  });

  it('delete then field-only edit without deleted leaves row deleted', () => {
    const change1 = {
      table: 'items',
      id: 'item1',
      profile: 'work' as const,
      updated_at: 100,
      fields: { title: 'Original' },
    };

    applyChanges(db, [change1]);

    const change2 = {
      table: 'items',
      id: 'item1',
      profile: 'work' as const,
      updated_at: 100,
      fields: {},
      deleted: true,
    };

    applyChanges(db, [change2]);

    const change3 = {
      table: 'items',
      id: 'item1',
      profile: 'work' as const,
      updated_at: 150,
      fields: { title: 'Edited' },
    };

    applyChanges(db, [change3]);

    const pulled = pullChanges(db, 0);
    const item = pulled.changes.find((c) => c.id === 'item1');
    expect(item?.deleted).toBe(true);
  });

  it('missing updated_at throws', () => {
    expect(() => {
      applyChanges(db, [
        {
          table: 'items',
          id: 'item1',
          profile: 'work' as const,
          updated_at: undefined as any,
          fields: { title: 'Item' },
        },
      ]);
    }).toThrow('Invalid updated_at');
  });

  it('non-finite updated_at throws', () => {
    expect(() => {
      applyChanges(db, [
        {
          table: 'items',
          id: 'item1',
          profile: 'work' as const,
          updated_at: Infinity,
          fields: { title: 'Item' },
        },
      ]);
    }).toThrow('Invalid updated_at');
  });

  it('non-finite field_times value throws', () => {
    expect(() => {
      applyChanges(db, [
        {
          table: 'items',
          id: 'item1',
          profile: 'work' as const,
          updated_at: 1000,
          fields: { title: 'Item' },
          field_times: { title: Infinity },
        },
      ]);
    }).toThrow('Invalid field_times');
  });
});

describe('openDb', () => {
  it('adds new columns to an existing table', () => {
    const file = `${os.tmpdir()}/assistant-migrate-${Date.now()}.db`;
    const old = new Database(file);
    old.exec(`CREATE TABLE facts (id TEXT NOT NULL, profile TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0, field_times TEXT NOT NULL DEFAULT '{}', text, item_id, superseded_by, PRIMARY KEY (profile, id))`);
    old.exec(`INSERT INTO facts (id, profile, version, updated_at, text) VALUES ('f1', 'work', 1, 1, 'kept')`);
    old.close();
    const migrated = openDb(file);
    const cols = (migrated.prepare('PRAGMA table_info(facts)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(TABLES.facts));
    expect(migrated.prepare('SELECT text FROM facts').get()).toEqual({ text: 'kept' });
    migrated.close();
    fs.rmSync(file, { force: true });
  });
});
