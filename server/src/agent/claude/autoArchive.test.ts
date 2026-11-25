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
    expect(idleChats(list, new Set(['pinned']), now)).toEqual(['old']);
  });
});
