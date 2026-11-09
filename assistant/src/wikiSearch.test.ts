import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from './db.js';
import { wikiRoutes } from './routes/wiki.js';
import { applyChanges } from './sync.js';
import { searchWiki } from './wikiSearch.js';

let tick = 1_000;
const row = (table: string, id: string, fields: Record<string, unknown>, profile: 'work' | 'personal' = 'work') => ({ table, id, profile, updated_at: ++tick, fields });
const ids = (rows: Record<string, unknown>[]) => rows.map((r) => r.id);

test('searchWiki ranks claims, matches on any word and scopes by profile', () => {
  const db = openDb(':memory:');
  applyChanges(db, [
    row('pages', 'p1', { title: 'Gateway', section: 'Systems', state: 'live' }),
    row('pages', 'p2', { title: 'Old gateway', section: 'Systems', state: 'rejected' }),
    row('facts', 'f1', { page_id: 'p1', text: 'The API gateway applies a rate limit of 60 requests a minute.', at: 5 }),
    row('facts', 'f2', { page_id: 'p1', text: 'The gateway has a limit per user.', at: 9 }),
    row('facts', 'f3', { page_id: 'p1', text: 'Deploys are on Fridays.', at: 7 }),
    row('facts', 'f4', { page_id: 'p1', text: 'The gateway limit is secret.' }, 'personal'),
  ]);
  const r = searchWiki(db, 'api gateway rate limit', 'work');
  expect(ids(r.claims)).toEqual(['f1', 'f2']);
  expect(r.pages).toEqual([{ id: 'p1', title: 'Gateway', section: 'Systems', state: 'live' }]);
  expect(searchWiki(db, 'gateway "limit*', 'work').claims.length).toBe(2);
  expect(searchWiki(db, '(a OR b) - : *', 'work')).toEqual({ pages: [], claims: [] });
  expect(searchWiki(db, 'with that', 'work')).toEqual({ pages: [], claims: [] });
});

test('the index follows inserts, updates, soft deletes and deletes', () => {
  const db = openDb(':memory:');
  const hits = (q: string) => ids(searchWiki(db, q, 'work').claims);
  applyChanges(db, [row('pages', 'p1', { title: 'Billing', state: 'live' }), row('facts', 'f1', { page_id: 'p1', text: 'Invoices go out nightly.' })]);
  expect(hits('invoices')).toEqual(['f1']);
  applyChanges(db, [row('facts', 'f1', { text: 'Receipts go out nightly.' })]);
  expect(hits('invoices')).toEqual([]);
  expect(hits('receipts')).toEqual(['f1']);
  applyChanges(db, [{ ...row('facts', 'f1', {}), deleted: true }]);
  expect(hits('receipts')).toEqual([]);
  applyChanges(db, [row('facts', 'f2', { page_id: 'p1', text: 'Refunds take a week.' })]);
  expect(hits('refunds')).toEqual(['f2']);
  db.exec("DELETE FROM facts WHERE id = 'f2'");
  expect(hits('refunds')).toEqual([]);
});

test('opening a hub db without the FTS tables indexes existing rows', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-')), 'hub.db');
  const db = openDb(file);
  applyChanges(db, [row('pages', 'p1', { title: 'Billing', state: 'live' }), row('facts', 'f1', { page_id: 'p1', text: 'Invoices go out nightly.' })]);
  for (const t of ['facts', 'pages']) {
    for (const s of ['ai', 'ad', 'au']) db.exec(`DROP TRIGGER ${t}_fts_${s}`);
    db.exec(`DROP TABLE ${t}_fts`);
  }
  db.close();
  const again = openDb(file);
  expect(ids(searchWiki(again, 'invoices', 'work').claims)).toEqual(['f1']);
  expect(ids(searchWiki(again, 'billing', 'work').pages)).toEqual(['p1']);
});

test('GET /wiki/search needs a profile and returns empty lists for an empty query', () => {
  const db = openDb(':memory:');
  const call = (qs: string) => {
    const out = { status: 0, body: '' };
    const res = { writeHead: (status: number) => (out.status = status), end: (body: string) => (out.body = body) };
    wikiRoutes['GET /wiki/search']({ res, url: new URL(`http://x/wiki/search${qs}`), getDb: () => db } as never);
    return out;
  };
  expect(call('?q=a').status).toBe(400);
  expect(call('?profile=work&q=')).toEqual({ status: 200, body: JSON.stringify({ pages: [], claims: [] }) });
});
