import { expect, test } from 'bun:test';
import { openDb } from './db.js';
import { askContext, contextText, liveClaims } from './draft.js';
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
    row('items', 't1', { title: 'Fix the invoices export to finance', status: 'open', at: now + 86400000 }),
    row('items', 't2', { title: 'Invoices export retry', status: 'done' }),
    row('items', 't3', { title: 'Reply about the invoices export', status: 'open', source: 'slack' }),
  ]);
  const slack = db.prepare('INSERT INTO slack_decisions (profile, id, text, channel, url, at) VALUES (?, ?, ?, ?, ?, ?)');
  slack.run('work', 'd1', 'Finance gets the invoices export as CSV', 'billing', 'https://example.com/d1', now - 3 * 86400000);
  slack.run('work', 'd2', 'Finance gets the invoices export as XLSX', 'billing', 'https://example.com/d2', now - 20 * 86400000);
  expect(askContext(db, 'Can you check why the invoices export to finance failed?', now)).toEqual({
    claims: [{ id: 'f1', line: 'Billing: Invoices export runs nightly to the finance bucket.', url: null, at: now }],
    decisions: ['Finance gets the invoices export as CSV (#billing, 2026-10-25, see https://example.com/d1)', 'Invoices export goes weekly from November (Billing sync)'],
    tasks: ['Fix the invoices export to finance, due 2026-10-29'],
    person: undefined,
  });
  // A short ask matches on one key word.
  expect(askContext(db, 'invoices?', now).claims.map((c) => c.id)).toEqual(['f1', 'f4']);
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

test('askContext adds what I know about the asker', () => {
  const db = openDb(':memory:');
  const row = (table: string, id: string, fields: Record<string, unknown>) => ({ table, id, profile: 'work' as const, updated_at: now, fields });
  applyChanges(db, [
    row('pages', 'p1', { title: 'Who does what', state: 'live' }),
    row('facts', 'f1', { page_id: 'p1', text: 'Mira owns the invoices export.' }),
    row('facts', 'f2', { page_id: 'p1', text: 'Miranda owns the roadmap.' }),
    row('items', 'said:s1', { title: 'Send Mira the export', status: 'open', source: 'slack', people: 'Mira Test · #billing', at: now + 86400000 }),
    row('items', 'said:s2', { title: 'Send Miranda the plan', status: 'open', source: 'slack', people: 'Miranda Test · #billing' }),
    row('items', 'said:s3', { title: 'Send Mira the old file', status: 'done', source: 'slack', people: 'Mira Test · #billing' }),
  ]);
  db.prepare('INSERT INTO replies (profile, id, who, chat, mode, status, at, text, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('work', 'r1', 'Mira Test', '#billing', 'live', 'sent', now - 86400000, 'It runs nightly.', now - 86400000);
  expect(askContext(db, 'invoices?', now, 'Mira Test').person).toEqual({
    role: ['Mira owns the invoices export.'],
    replies: ['2026-10-27: It runs nightly.'],
    promises: ['Send Mira the export, due 2026-10-29'],
  });
  expect(askContext(db, 'invoices?', now).person).toBeUndefined();
});

test('contextText dates a claim older than 30 days', () => {
  const ctx = { claims: [{ id: 'f1', line: 'Billing: Invoices are in euros.', url: null, at: now - 40 * 86400000 }, { id: 'f2', line: 'Billing: Invoices export runs nightly.', url: 'https://example.com/x', at: now - 2 * 86400000 }], decisions: [], tasks: ['Fix the export'], person: undefined };
  expect(contextText(ctx, now)).toBe('Wiki [f1]: Billing: Invoices are in euros. (as of 2026-09-18)\nWiki [f2]: Billing: Invoices export runs nightly. (see https://example.com/x)\nMy task: Fix the export');
});
