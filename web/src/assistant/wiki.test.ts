import { describe, expect, it } from 'vitest';
import { sampleWiki } from './sample';
import { actionCount, contestOf, groupMeetings, pageClaims, pageStats, searchWiki } from './wiki';

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
    expect(contestOf(facts.find((f) => f.contested)!)?.by).toBe('Ben');
  });
});

describe('searchWiki', () => {
  const { pages, facts } = sampleWiki(Date.UTC(2026, 9, 25));

  it('matches every word in pages and current claims', () => {
    const r = searchWiki(pages, facts, 'vendor mcp');
    expect(r.pages).toEqual([]);
    expect(r.claims.map((f) => f.id)).toEqual(['f-vendor']);
  });

  it('matches source labels and returns nothing for an empty query', () => {
    expect(searchWiki(pages, facts, 'aie-924').claims).toHaveLength(2);
    expect(searchWiki(pages, facts, '  ')).toEqual({ pages: [], claims: [] });
  });
});

describe('meetings', () => {
  const now = new Date(2026, 9, 25, 12).getTime();
  const { meetings, actions } = sampleWiki(now);

  it('groups today, upcoming and past days', () => {
    const g = groupMeetings(meetings, now);
    expect(g.map((x) => x.label).slice(0, 2)).toEqual(['Today', 'Upcoming']);
    expect(g.map((x) => x.rows.map((m) => m.id))).toEqual([['m-standup'], ['m-pricing'], ['m-codex', 'm-gateway'], ['m-planning']]);
  });

  it('counts handled actions', () => {
    expect(actionCount(actions, 'm-gateway')).toEqual({ total: 3, handled: 0 });
    expect(actionCount(actions, 'm-codex')).toEqual({ total: 1, handled: 1 });
  });
});
