import { describe, expect, it } from 'bun:test';
import { setRoots } from '../../app/store';
import { findPending, requestFind, takeFind } from './FindBar';

describe('takeFind', () => {
  it('gives a sub-chat hit, keyed by the root, to any session of that chat', () => {
    setRoots([{ sessionId: 'latest', parentId: 'root' }]);
    requestFind({ sessionId: 'root', query: 'word', at: 1, sub: 'task2' }, false);
    expect(findPending('other')).toBe(false);
    expect(takeFind('other')).toBeNull();
    expect(findPending('latest')).toBe(true);
    expect(takeFind('latest')?.sub).toBe('task2');
    expect(takeFind('latest')).toBeNull();
  });
});
