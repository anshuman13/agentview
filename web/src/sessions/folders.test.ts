import { describe, expect, it } from 'vitest';
import type { LiveChat } from '../../../shared/protocol';
import { chatMenuItems, chatSwipe } from './folders';

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

describe('chatMenuItems', () => {
  const all = { failed: true, canPin: true, beside: true, closable: true };
  it('orders every item with retry first and archive last', () => {
    expect(chatMenuItems(all)).toEqual(['retry', 'pin', 'mute', 'rename', 'beside', 'close', 'separator', 'archive']);
  });
  it('drops retry unless failed, and the optional items when absent', () => {
    expect(chatMenuItems({ ...all, failed: false })).toEqual(['pin', 'mute', 'rename', 'beside', 'close', 'separator', 'archive']);
    expect(chatMenuItems({ failed: false, canPin: false, beside: false, closable: false })).toEqual(['rename', 'separator', 'archive']);
    expect(chatMenuItems({ failed: true, canPin: false, beside: true, closable: false })).toEqual(['retry', 'rename', 'beside', 'separator', 'archive']);
    expect(chatMenuItems({ ...all, failed: false, unread: true })).toEqual(['pin', 'unread', 'mute', 'rename', 'beside', 'close', 'separator', 'archive']);
  });
});
