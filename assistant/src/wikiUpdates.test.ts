import { describe, expect, it } from 'bun:test';
import { openDb } from './db.js';
import { applyChanges } from './sync.js';
import { type Candidate, proposeWikiUpdates } from './wikiUpdates.js';

const DAY = 86_400_000;
const now = Date.parse('2026-10-30T12:00:00Z');
const row = (table: string, id: string, fields: Record<string, unknown>) => ({ table, id, profile: 'work' as const, updated_at: 1, fields });

function setup() {
  const db = openDb(':memory:');
  applyChanges(db, [
    row('pages', 'p1', { title: 'Pricing' }),
    row('pages', 'p2', { title: 'Hiring' }),
    row('facts', 'price', { text: 'Basic plan costs 10 euros monthly', page_id: 'p1', at: 1 }),
    row('facts', 'old', { text: 'Basic plan costs 8 euros monthly', page_id: 'p1', at: 1, superseded_by: 'price' }),
    row('facts', 'annual', { text: 'Annual billing is 100 euros', page_id: 'p1', at: 1 }),
    row('facts', 'hire', { text: 'Hiring two engineers for the plan', page_id: 'p2', at: 1 }),
    row('meetings', 'cal:m', { title: 'Pricing review', starts_at: now - DAY, ends_at: now - DAY + 3600_000, decisions: '["Basic plan now costs 12 euros monthly","Hire engineers in Q3"]' }),
    row('meetings', 'cal:gone', { title: 'Pricing review', starts_at: now - 20 * DAY, ends_at: now - 20 * DAY, decisions: '["Basic plan now costs 11 euros monthly"]' }),
    row('meetings', 'cal:none', { title: 'Pricing chat', starts_at: now - DAY, ends_at: now - DAY, decisions: '[]' }),
  ]);
  return db;
}

describe('wiki updates', () => {
  it('asks about claims a recent decision may change and proposes each update once', async () => {
    const db = setup();
    const asked: Candidate[][] = [];
    const text = 'As of 29 Oct 2026, the Basic plan costs 12 euros monthly.';
    const ask = async (_p: string, _m: unknown, found: Candidate[]) => {
      asked.push(found);
      return [{ claim: 'price', text }, { claim: 'price', text: ` ${text} ` }, { claim: 'nope', text: 'x' }];
    };
    expect(await proposeWikiUpdates(db, now, ask)).toBe(1);
    expect(asked.map((f) => f.map((c) => [c.claim.id, c.decisions]))).toEqual([[['price', ['Basic plan now costs 12 euros monthly']]]]);
    expect(db.prepare("SELECT text, page_id, state, replaces, added_by, sources FROM facts WHERE state = 'proposed'").all()).toEqual([
      { text, page_id: 'p1', state: 'proposed', replaces: 'price', added_by: 'meeting:cal:m', sources: '[{"kind":"meeting","label":"Pricing review"}]' },
    ]);
    expect(await proposeWikiUpdates(db, now + DAY, ask)).toBe(0);
    expect(asked).toHaveLength(1);
    db.prepare("DELETE FROM meta WHERE key LIKE 'wikiupdate:%'").run();
    expect(await proposeWikiUpdates(db, now, ask)).toBe(0);
  });
});
