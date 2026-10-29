import { expect, it } from 'vitest';
import { parseSaved } from './restore.js';

it('returns null for input that is not a saved chat list', () => {
  expect(parseSaved('{}')).toBeNull();
  expect(parseSaved('null')).toBeNull();
  expect(parseSaved('not json')).toBeNull();
  expect(parseSaved('{"chats":"x"}')).toBeNull();
});

it('fills in missing crons and drops entries without a session id', () => {
  const r = parseSaved('{"view":"a","chats":[{"sessionId":"a"},{"crons":[]},null,{"sessionId":"b","crons":[{"id":"c"}]}]}');
  expect(r).toEqual({ view: 'a', chats: [{ sessionId: 'a', crons: [] }, { sessionId: 'b', crons: [{ id: 'c' }] }] });
});
