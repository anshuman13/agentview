import { describe, expect, it } from 'vitest';
import { rankNeeds } from './needsYou';

describe('rankNeeds', () => {
  it('keeps group order and shows an item once, from its earliest group', () => {
    const n = (id: string, ...keys: string[]) => ({ id, keys });
    const out = rankNeeds([[n('a', 'task:1')], [n('b', 'task:1'), n('c', 'task:2', 'url:x')], [n('d', 'url:x'), n('e', 'chat:1')], [n('f', 'chat:1')]]);
    expect(out.map((x) => x.id)).toEqual(['a', 'c', 'e']);
    const asks = rankNeeds([[{ id: 'a', keys: ['task:1'], marks: ['url:x'] }, { id: 'b', keys: ['task:2'], marks: ['url:x'] }], [{ id: 'c', keys: ['url:x'] }]]);
    expect(asks.map((x) => x.id)).toEqual(['a', 'b']);
  });
});
