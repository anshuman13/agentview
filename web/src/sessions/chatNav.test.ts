import { describe, expect, it } from 'vitest';
import type { LiveChat } from '../../../shared/protocol';
import { chatOrder, nextUnread, stepChat } from './chatNav';

const chat = (id: string) => ({ id }) as LiveChat;

describe('stepChat', () => {
  const ids = ['a', 'b', 'c'];
  it('steps and wraps both ways', () => {
    expect(stepChat(ids, 'a', 1)).toBe('b');
    expect(stepChat(ids, 'c', 1)).toBe('a');
    expect(stepChat(ids, 'c', -1)).toBe('b');
    expect(stepChat(ids, 'a', -1)).toBe('c');
  });
  it('picks the first or last when the viewed chat is not listed', () => {
    expect(stepChat(ids, 'x', 1)).toBe('a');
    expect(stepChat(ids, 'x', -1)).toBe('c');
  });
  it('does nothing with fewer than two chats', () => {
    expect(stepChat([], 'a', 1)).toBeNull();
    expect(stepChat(['a'], 'a', -1)).toBeNull();
  });
});

describe('chatOrder', () => {
  it('lists waiting, pinned, then groups once each', () => {
    const order = chatOrder([chat('w')], [chat('w'), chat('p')], [{ open: [chat('w'), chat('g1')] }, { open: [chat('g2')] }]);
    expect(order).toEqual(['w', 'p', 'g1', 'g2']);
  });
});

describe('nextUnread', () => {
  it('picks the next unread chat, or null when none but the viewed one', () => {
    expect(nextUnread([], 'a', 1)).toBeNull();
    expect(nextUnread(['a'], 'a', 1)).toBeNull();
    expect(nextUnread(['b'], 'a', -1)).toBe('b');
    expect(nextUnread(['b', 'c'], 'a', 1)).toBe('b');
    expect(nextUnread(['b', 'c'], 'b', 1)).toBe('c');
    expect(nextUnread(['b', 'c'], 'a', -1)).toBe('c');
  });
});
