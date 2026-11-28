import { describe, expect, it } from 'bun:test';
import { sectionChoices, sectionGroups, sectionList, sectionName } from './sections';

const chat = (sessionId: string, section?: string, lastModified = 0) => ({ sessionId, lastModified, ...(section && { section }) });

describe('sections', () => {
  const chats = [chat('a', 'Work', 1), chat('b', 'Work', 2), chat('c', 'Admin'), chat('d')];

  it('counts sections by name', () => {
    expect(sectionList(chats)).toEqual([{ name: 'Admin', count: 1 }, { name: 'Work', count: 2 }]);
  });

  it('groups chats newest first', () => {
    expect(sectionGroups(chats).map((g) => [g.name, g.chats.map((c) => c.sessionId)])).toEqual([['Admin', ['c']], ['Work', ['b', 'a']]]);
  });

  it('offers other sections and a new one for an unused name', () => {
    expect(sectionChoices(chats, 'Work', '').list.map((s) => s.name)).toEqual(['Admin']);
    expect(sectionChoices(chats, undefined, '  Side  work ').fresh).toBe('Side work');
    expect(sectionChoices(chats, undefined, 'work').fresh).toBeNull();
  });

  it('cleans names', () => {
    expect(sectionName(' a  b ')).toBe('a b');
  });
});
