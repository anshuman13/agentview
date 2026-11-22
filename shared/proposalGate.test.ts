import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { decisionHistory, examplesFor, gateProposal, type FactRow } from './proposalGate.js';

type Case = { name: string; history: Omit<FactRow, 'updated_at'>[]; text: string; source: string; onPage: boolean; expected: string | null };
const cases = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'proposal-gate.json'), 'utf8')) as Case[];
const rows = (h: Case['history']) => h.map((r, i) => ({ ...r, updated_at: i + 1 }));

describe('gateProposal', () => {
  for (const c of cases) it(c.name, () => expect(gateProposal(c.text, c.source, c.onPage, decisionHistory(rows(c.history)))).toBe(c.expected));

  it('keeps every rejection, so an old one still blocks a similar claim', () => {
    const history = decisionHistory(Array.from({ length: 300 }, (_, i) => ({
      id: `learn:${i}`, text: i === 249 ? 'Release notes always list breaking changes first' : `Rejected topic${i} wording`, added_by: 'claude:c1', state: 'rejected', updated_at: i + 1,
    })));
    expect(gateProposal('Release notes list breaking changes first always', 'chat', false, history)).toBe('Like a rejected claim');
  });
});

describe('examplesFor', () => {
  it('lists the newest approved and rejected claims of the source, a reason in brackets', () => {
    const history = decisionHistory([
      { id: 'a', text: 'Old approved', added_by: 'voice', state: 'live', updated_at: 1 },
      { id: 'b', text: 'New approved', added_by: 'voice', state: null, updated_at: 5 },
      { id: 'c', text: 'Rejected one', added_by: 'voice', state: 'rejected', updated_at: 2, decided_at: 9, reject_reason: 'Too narrow' },
      { id: 'd', text: 'Other source', added_by: 'people', state: 'rejected', updated_at: 3 },
    ]);
    expect(examplesFor(history, 'voice')).toEqual([
      'Approved before, propose claims like these:', '- New approved', '- Old approved', '',
      'Rejected before, do not propose claims like these:', '- Rejected one [Too narrow]',
    ]);
    expect(examplesFor(history, 'chat')).toContain('(none)');
  });
});
