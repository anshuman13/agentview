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

describe('collapse', () => {
  it('merges the picked entries into one at the first place from min up', () => {
    const one = (xs: string[]) => xs.join('+');
    const pick = (x: string) => x.startsWith('o');
    expect(collapse(['a', 'o1', 'b', 'o2', 'o3'], pick, 3, one)).toEqual(['a', 'o1+o2+o3', 'b']);
    expect(collapse(['a', 'o1', 'o2'], pick, 3, one)).toEqual(['a', 'o1', 'o2']);
  });
});
