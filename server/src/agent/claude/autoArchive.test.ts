import { describe, expect, it } from 'bun:test';
import { ARCHIVE_MS } from '../../../../shared/protocol.js';
import { idleChats } from './autoArchive.js';

describe('idleChats', () => {
  it('picks chats idle past two days that are not kept', () => {
    const now = 10 * ARCHIVE_MS;
    const list = [
      { sessionId: 'fresh', lastModified: now - ARCHIVE_MS + 1000 },
      { sessionId: 'old', lastModified: now - ARCHIVE_MS - 1000 },
      { sessionId: 'pinned', lastModified: now - 3 * ARCHIVE_MS },
    ];
    expect(idleChats(list, new Set(['pinned']), {}, now)).toEqual(['old']);
  });

  it('archives a sub-chat group only when its latest session is idle and nothing in it is kept', () => {
    const now = 10 * ARCHIVE_MS;
    const old = now - 3 * ARCHIVE_MS;
    const list = [
      { sessionId: 'a', lastModified: old }, { sessionId: 'a1', lastModified: now - 1000 },
      { sessionId: 'b', lastModified: old }, { sessionId: 'b1', lastModified: old },
      { sessionId: 'c', lastModified: old }, { sessionId: 'c1', lastModified: old },
    ];
    const links = { a1: { parent: 'a', via: 'build' as const, at: 1 }, b1: { parent: 'b', via: 'clear' as const, at: 1 }, c1: { parent: 'c', via: 'clear' as const, at: 1 } };
    expect(idleChats(list, new Set(['c1']), links, now)).toEqual(['b', 'b1']);
  });
});
