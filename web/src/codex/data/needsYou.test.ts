import { describe, expect, it } from 'vitest';
import { collapse, rankNeeds } from './needsYou';

describe('rankNeeds', () => {
  it('keeps group order and shows an item once, from its earliest group', () => {
    const n = (id: string, ...keys: string[]) => ({ id, keys });
    const out = rankNeeds([[n('a', 'task:1')], [n('b', 'task:1'), n('c', 'task:2', 'url:x')], [n('d', 'url:x'), n('e', 'chat:1')], [n('f', 'chat:1')]]);
    expect(out.map((x) => x.id)).toEqual(['a', 'c', 'e']);
    const asks = rankNeeds([[{ id: 'a', keys: ['task:1'], marks: ['url:x'] }, { id: 'b', keys: ['task:2'], marks: ['url:x'] }], [{ id: 'c', keys: ['url:x'] }]]);
    expect(asks.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('rankNeeds count rows', () => {
  it('puts just-ended actions, stale asks and wiki claims last, once each, and skips empty groups', () => {
    const n = (id: string, ...keys: string[]) => ({ id, keys });
    const out = rankNeeds([[n('overdue', 'task:1')], [n('dm', 'chat:1')], [n('ended1', 'task:1'), n('ended2', 'task:2')], [n('stale', 'stale-asks')], [n('wiki', 'wiki-claims')]]);
    expect(out.map((x) => x.id)).toEqual(['overdue', 'dm', 'ended2', 'stale', 'wiki']);
    expect(rankNeeds([[n('dm', 'chat:1')], [], []]).map((x) => x.id)).toEqual(['dm']);
  });
});

describe('collapse', () => {
  it('merges the picked entries into one at the first place from min up', () => {
    const one = (xs: string[]) => xs.join('+');
    const pick = (x: string) => x.startsWith('o');
    expect(collapse(['a', 'o1', 'b', 'o2', 'o3'], pick, 3, one)).toEqual(['a', 'o1+o2+o3', 'b']);
    expect(collapse(['a', 'o1', 'o2'], pick, 3, one)).toEqual(['a', 'o1', 'o2']);
  });
});
