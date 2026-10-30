import { expect, test } from 'bun:test';
import { openDb } from './db.js';
import { askContext } from './draft.js';
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
    claims: ['Billing: Invoices export runs nightly to the finance bucket.'],
    decisions: ['Invoices export goes weekly from November (Billing sync)'],
  });
});
