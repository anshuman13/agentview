import { describe, expect, it } from 'bun:test';
import { nestLoops, nestTargets, nestedRows } from './nest';

const chat = (sessionId: string, nestedIn?: string, lastModified = 0) => ({ sessionId, title: `Chat ${sessionId}`, cwd: `/r/${sessionId}`, lastModified, ...(nestedIn && { nestedIn }) });

describe('nest', () => {
  it('finds loops through the parent chain', () => {
    expect(nestLoops({ b: 'a' }, 'a', 'b')).toBe(true);
    expect(nestLoops({}, 'a', 'a')).toBe(true);
    expect(nestLoops({ b: 'a' }, 'c', 'b')).toBe(false);
  });

  it('lists targets without itself, its children or its current parent, matching title or folder', () => {
    const chats = [chat('a'), chat('b', 'a'), chat('c'), chat('d')];
    expect(nestTargets(chats, 'a').map((c) => c.sessionId)).toEqual(['c', 'd']);
    expect(nestTargets(chats, 'b').map((c) => c.sessionId)).toEqual(['c', 'd']);
    expect(nestTargets(chats, 'a', '/r/d').map((c) => c.sessionId)).toEqual(['d']);
  });

  it('groups nested chats under listed parents, newest first', () => {
    const under = nestedRows([chat('a'), chat('b', 'a', 1), chat('c', 'a', 2), chat('d', 'gone')]);
    expect(under.get('a')!.map((c) => c.sessionId)).toEqual(['c', 'b']);
    expect(under.has('gone')).toBe(false);
  });
});

describe('withoutNested', () => {
  it('drops the chats shown under a parent', async () => {
    const { withoutNested } = await import('./nest');
    const chats = [chat('a'), chat('b', 'a'), chat('c', 'gone')];
    expect(withoutNested(chats, nestedRows(chats)).map((c) => c.sessionId)).toEqual(['a', 'c']);
  });
});
