import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { groupSessions, linkOlder, rootOf, searchHitRows, subChatLabel } from './subChats';

const fx = JSON.parse(readFileSync(new URL('./fixtures/sub-chats.json', import.meta.url), 'utf8'));

describe('sub-chats', () => {
  for (const c of fx.rootOf) it(`rootOf: ${c.name}`, () => expect(rootOf(c.links, c.id)).toBe(c.expected));
  for (const c of fx.subChatLabel) it(`subChatLabel: ${c.count} ${c.allBuild}`, () => expect(subChatLabel(c.count, c.allBuild)).toBe(c.expected));
  for (const c of fx.groupSessions) it(`groupSessions: ${c.name}`, () => expect(groupSessions(c.saved, c.open).map((r) => ({ ...r, root: r.root.sessionId }))).toEqual(c.expected));
  for (const c of fx.searchHitRows) it(`searchHitRows: ${c.name}`, () => expect(searchHitRows(c.hits)).toEqual(c.expected));
  for (const c of fx.linkOlder) it(`linkOlder: ${c.name}`, () => expect(linkOlder(c.sessions, c.links, c.runs)).toEqual(c.expected));
});
