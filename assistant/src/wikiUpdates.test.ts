import { describe, expect, it } from 'bun:test';
import { openDb } from './db.js';
import { saveScan } from './slackSave.js';
import { applyChanges } from './sync.js';
import { type Candidate, type Origin, proposeWikiUpdates } from './wikiUpdates.js';

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
    expect(asked).toHaveLength(1);
    await proposeWikiUpdates(db, now + 15 * DAY, ask);
    expect(db.prepare("SELECT key FROM meta WHERE key LIKE 'wikiupdate%'").all()).toEqual([]);
  });

  it('tries a failing origin three times before skipping it', async () => {
    const db = setup();
    let asked = 0;
    const ask = async () => {
      asked++;
      throw new Error('network down');
    };
    for (let i = 0; i < 4; i++) expect(await proposeWikiUpdates(db, now, ask)).toBe(0);
    expect(asked).toBe(3);
  });

  it('proposes updates from Slack channel decisions once each, with a Slack source', async () => {
    const db = setup();
    db.prepare("INSERT INTO meta (key, value) VALUES ('wikiupdate:work:cal:m', ?)").run(String(now));
    const url = 'https://team.slack.test/archives/C1/p1';
    const decision = { text: 'Basic plan costs 15 euros monthly', channel: 'pricing', url, time: '2026-10-29T10:00' };
    const scan = (d: object[]) => saveScan(db, { chats: [], asks: [], answered: [], decisions: d as never }, now);
    scan([decision, decision, { ...decision, url: 'javascript:x' }, { ...decision, text: 'Old', time: '2026-10-01T10:00' }]);
    scan([decision]);
    const asked: Origin[] = [];
    const ask = async (_p: string, o: Origin) => {
      asked.push(o);
      return [{ claim: 'price', text: 'As of 29 Oct 2026, the Basic plan costs 15 euros monthly.' }];
    };
    expect(await proposeWikiUpdates(db, now, ask)).toBe(1);
    expect(await proposeWikiUpdates(db, now, ask)).toBe(0);
    expect(asked.map((o) => o.decisions)).toEqual([['Basic plan costs 15 euros monthly']]);
    const row = db.prepare("SELECT replaces, added_by, sources FROM facts WHERE state = 'proposed'").get() as { replaces: string; added_by: string; sources: string };
    expect(row.replaces).toBe('price');
    expect(row.added_by).toMatch(/^slack:[0-9a-f]{16}$/);
    expect(JSON.parse(row.sources)).toEqual([{ kind: 'slack', label: '#pricing', url }]);
  });
});
