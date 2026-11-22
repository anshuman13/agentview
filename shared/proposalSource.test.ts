import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { proposalSource, type ProposalSource } from './proposalSource';

const cases = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'proposal-source.json'), 'utf8')) as { name: string; id: string; added_by: string | null; expected: ProposalSource | null }[];

describe('proposalSource', () => {
  for (const c of cases) it(c.name, () => expect(proposalSource(c)).toEqual(c.expected));
});
