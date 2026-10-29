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

const ch = (o: Record<string, unknown>) => ({ table: 'items', id: 'item1', profile: 'work' as const, updated_at: 1000, fields: {}, ...o }) as any;
const item = (id = 'item1') => pullChanges(db, 0).changes.find((c) => c.id === id);

describe('sync', () => {
  it('insert then pull', () => {
    const applied = applyChanges(db, [ch({ fields: { title: 'Item 1', text: 'Description' } })]);
    expect(applied.applied).toBe(1);
    expect(applied.version).toBeGreaterThan(0);
    expect(item()?.fields).toMatchObject({ title: 'Item 1', text: 'Description' });
  });

  it('merges per field by timestamp: newer wins, older loses, tie keeps stored, other fields survive', () => {
    applyChanges(db, [ch({ fields: { title: 'Old', text: 'Text 1' }, field_times: { title: 1000, text: 1000 } })]);
    applyChanges(db, [ch({ updated_at: 2000, fields: { title: 'New' }, field_times: { title: 2000 } })]);
    expect(item()?.fields).toMatchObject({ title: 'New', text: 'Text 1' });
    applyChanges(db, [ch({ updated_at: 1000, fields: { title: 'Older' }, field_times: { title: 1000 } })]);
    applyChanges(db, [ch({ updated_at: 2000, fields: { title: 'Tie' }, field_times: { title: 2000 } })]);
    expect(item()?.fields.title).toBe('New');
    applyChanges(db, [ch({ updated_at: 3000, fields: { source: 'web' }, field_times: { source: 3000 } })]);
    expect(item()?.fields).toMatchObject({ title: 'New', text: 'Text 1', source: 'web' });
  });

  it('an apply that changes nothing does not bump the version', () => {
    applyChanges(db, [ch({ fields: { title: 'Item 1' }, field_times: { title: 1000 } })]);
    const version = pullChanges(db, 0).version;
    expect(applyChanges(db, [ch({ updated_at: 500, fields: { title: 'Old' }, field_times: { title: 500 } })]).applied).toBe(0);
    expect(pullChanges(db, 0).version).toBe(version);
  });

  it('a delete wins over later-applied edits that are not newer than it', () => {
    applyChanges(db, [ch({ updated_at: 100, fields: { title: 'Original' } })]);
    applyChanges(db, [ch({ updated_at: 3000, deleted: true })]);
    applyChanges(db, [ch({ updated_at: 2000, fields: { title: 'Updated' }, field_times: { title: 2000 } })]);
    expect(item()?.deleted).toBe(true);
    applyChanges(db, [ch({ id: 'item2', updated_at: 100, fields: { title: 'Original' } })]);
    applyChanges(db, [ch({ id: 'item2', updated_at: 100, deleted: true })]);
    applyChanges(db, [ch({ id: 'item2', updated_at: 150, fields: { title: 'Edited' } })]);
    expect(item('item2')?.deleted).toBe(true);
  });

  it('pulls pages by version across tables, and only newer than since', () => {
    applyChanges(db, [
      ch({ id: 'item1', fields: { title: 'Item 1' } }),
      ch({ id: 'item2', fields: { title: 'Item 2' } }),
      ch({ table: 'people', id: 'person1', fields: { name: 'Person 1' } }),
      ch({ table: 'people', id: 'person2', fields: { name: 'Person 2' } }),
    ]);
    const first = pullChanges(db, 0, 2);
    expect(first.changes.length).toBe(2);
    expect(first.hasMore).toBe(true);
    const second = pullChanges(db, first.version, 2);
    expect(second.changes.length).toBe(2);
    expect(second.hasMore).toBe(false);
  });

  it('keeps the same id in work and personal as two rows', () => {
    applyChanges(db, [ch({ fields: { title: 'Work Item' } })]);
    applyChanges(db, [ch({ profile: 'personal', fields: { title: 'Personal Item' } })]);
    const pulled = pullChanges(db, 0);
    expect(pulled.changes.length).toBe(2);
    expect(pulled.changes.find((c) => c.profile === 'work')?.fields.title).toBe('Work Item');
    expect(pulled.changes.find((c) => c.profile === 'personal')?.fields.title).toBe('Personal Item');
  });

  it.each([
    ['Invalid table', { table: 'invalid_table' }],
    ['Invalid table', { table: 'toString' }],
    ['Invalid field', { fields: { invalid_field: 'value' } }],
    ['Invalid id', { id: '' }],
    ['Invalid profile', { profile: 'invalid' }],
    ['Invalid value type', { fields: { title: { nested: 'object' } } }],
    ['Invalid updated_at', { updated_at: undefined }],
    ['Invalid updated_at', { updated_at: Infinity }],
    ['Invalid field_times', { fields: { title: 'x' }, field_times: { title: Infinity } }],
  ])('rejects %s and applies nothing', (message, bad) => {
    expect(() => applyChanges(db, [ch({ id: 'ok', fields: { title: 'fine' } }), ch(bad)])).toThrow(message);
    expect(pullChanges(db, 0).changes.length).toBe(0);
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
