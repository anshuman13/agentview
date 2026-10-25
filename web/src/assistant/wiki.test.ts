import { describe, expect, it } from 'vitest';
import { sampleWiki } from './sample';
import { contestOf, pageClaims, pageStats } from './wiki';

describe('wiki', () => {
  const { facts } = sampleWiki(Date.UTC(2026, 9, 25));

  it('groups current claims by heading and keeps the ones they replaced', () => {
    const groups = pageClaims(facts, 'platform');
    expect(groups.map((g) => g.heading)).toEqual(['Ownership', 'Runbooks', 'Decisions']);
    const vendor = groups[0].claims.find((c) => c.fact.id === 'f-vendor')!;
    expect(vendor.old.map((f) => f.text)).toEqual(['Vendor MCP servers go through the gateway like internal ones.']);
    expect(groups.flatMap((g) => g.claims).some((c) => c.fact.superseded_by)).toBe(false);
  });

  it('counts claims and contested claims per page', () => {
    expect(pageStats(facts, 'edge-service')).toMatchObject({ claims: 5, contested: 1 });
    expect(contestOf(facts.find((f) => f.contested)!)?.by).toBe('Anshuman');
  });
});
