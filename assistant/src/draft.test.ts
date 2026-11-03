import { expect, test } from 'bun:test';
import { openDb } from './db.js';
import { askContext, liveClaims } from './draft.js';
import { applyChanges } from './sync.js';

const now = new Date(2026, 9, 28, 12).getTime();

test('askContext keeps live claims and recent decisions that share two key words, best first', () => {
  const db = openDb(':memory:');
  const row = (table: string, id: string, fields: Record<string, unknown>) => ({ table, id, profile: 'work' as const, updated_at: now, fields });
  applyChanges(db, [
    row('pages', 'p1', { title: 'Billing', state: 'live' }),
    row('pages', 'p2', { title: 'Old', state: 'retired' }),
    row('facts', 'f1', { page_id: 'p1', text: 'Invoices export runs nightly to the finance bucket.' }),
    row('facts', 'f2', { page_id: 'p1', text: 'Invoices export moved to weekly runs to the finance bucket.', superseded_by: 'f3' }),
    row('facts', 'f3', { page_id: 'p2', text: 'Invoices export runs to the finance bucket.' }),
    row('facts', 'f4', { page_id: 'p1', text: 'Invoices are in euros.' }),
    row('meetings', 'm1', { title: 'Billing sync', starts_at: now - 2 * 86400000, decisions: JSON.stringify(['Invoices export goes weekly from November']) }),
    row('meetings', 'm2', { title: 'Old sync', starts_at: now - 60 * 86400000, decisions: JSON.stringify(['Invoices export goes daily']) }),
  ]);
  expect(askContext(db, 'Can you check why the invoices export to finance failed?', now)).toEqual({
    claims: [{ id: 'f1', line: 'Billing: Invoices export runs nightly to the finance bucket.', url: null }],
    decisions: ['Invoices export goes weekly from November (Billing sync)'],
  });
});

test('askContext ranks a Support FAQ claim first on a tie and keeps its link; liveClaims drops dead ids', () => {
  const db = openDb(':memory:');
  const row = (table: string, id: string, fields: Record<string, unknown>) => ({ table, id, profile: 'work' as const, updated_at: now, fields });
  applyChanges(db, [
    row('pages', 'p1', { title: 'Billing', state: 'live' }),
    row('pages', 'p2', { title: 'Support FAQ', state: 'live' }),
    row('facts', 'f1', { page_id: 'p1', text: 'Invoices export runs nightly to the finance bucket.' }),
    row('facts', 'f2', { page_id: 'p2', text: 'Invoices export runs nightly to the finance bucket.', sources: JSON.stringify([{ kind: 'slack', label: 'x', url: 'https://example.com/t' }]) }),
    row('facts', 'f3', { page_id: 'p1', text: 'Old invoices export.', superseded_by: 'f1' }),
  ]);
  const { claims } = askContext(db, 'why did the invoices export to finance fail?', now);
  expect(claims.map((c) => c.id)).toEqual(['f2', 'f1']);
  expect(claims[0].url).toBe('https://example.com/t');
  expect(liveClaims(db, ['f1', 'f3', 'nope'])).toEqual(['f1']);
});
