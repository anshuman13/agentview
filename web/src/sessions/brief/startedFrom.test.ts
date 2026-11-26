import { describe, expect, it } from 'bun:test';
import { startedFrom } from './startedFrom';

const chats = [
  { sessionId: 'p', title: 'Plan the trip' },
  { sessionId: 'p1', title: 'Plan the trip', parentId: 'p' },
  { sessionId: 'b', title: 'Build: trip', spawnedBy: 'p1' },
  { sessionId: 'b1', title: 'Build: trip', parentId: 'b' },
  { sessionId: 'x', title: 'Other' },
];

describe('startedFrom', () => {
  it('links a build chat and its task sub-chats to the parent row', () => {
    expect(startedFrom(chats, 'b')).toEqual({ text: 'Started from Plan the trip', sessionId: 'p' });
    expect(startedFrom(chats, 'b1')).toEqual({ text: 'Started from Plan the trip', sessionId: 'p' });
  });

  it('returns nothing for a chat without spawnedBy', () => {
    expect(startedFrom(chats, 'x')).toBeNull();
    expect(startedFrom(chats, 'p1')).toBeNull();
    expect(startedFrom(chats, null)).toBeNull();
  });

  it('still links when the parent is not listed', () => {
    expect(startedFrom([{ sessionId: 'b', title: 'B', spawnedBy: 'gone' }], 'b')).toEqual({ text: 'Started from another chat', sessionId: 'gone' });
  });
});
