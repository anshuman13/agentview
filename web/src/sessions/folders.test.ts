import { describe, expect, it } from 'vitest';
import type { LiveChat } from '../../../shared/protocol';
import { chatSwipe } from './folders';

describe('chatSwipe', () => {
  it('pins an unpinned chat and unpins a pinned one', () => {
    expect(chatSwipe(false).right).toBe('pin');
    expect(chatSwipe(true).right).toBe('unpin');
  });
  it('archives on the left unless the chat is busy', () => {
    expect(chatSwipe(false).left).toBe('archive');
    const live = (o: object) => ({ running: false, pending: false, ...o }) as unknown as LiveChat;
    expect(chatSwipe(true, live({ running: true })).left).toBeNull();
    expect(chatSwipe(true, live({ pending: true })).left).toBeNull();
    expect(chatSwipe(true, live({})).left).toBe('archive');
  });
});
