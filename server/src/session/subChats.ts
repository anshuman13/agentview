import os from 'node:os';
import path from 'node:path';
import { rootOf as rootIn, type SubLinks, type SubVia } from '../../../shared/subChats.js';
import { jsonFile } from '../json.js';

const store = jsonFile<SubLinks>(path.join(os.homedir(), '.agentview', 'subchats.json'), {});

export const listLinks = () => store.read();

export const rootOf = async (id: string) => rootIn(await store.read(), id);

// Sub-chats of a root, oldest first.
export const childrenOf = async (root: string) => {
  const links = await store.read();
  return Object.entries(links)
    .filter(([child]) => child !== root && rootIn(links, child) === root)
    .sort(([, a], [, b]) => a.at - b.at)
    .map(([child]) => child);
};

// Links child to the root of parent's chain. A session never links to itself or gets a second parent.
export const linkSubChats = (add: { child: string; parent: string; via: SubVia; at: number }[]) =>
  store.update((links) => {
    let next = links;
    for (const { child, parent, via, at } of add) {
      const root = rootIn(next, parent);
      if (next[child] || root === child) continue;
      next = { ...next, [child]: { parent: root, via, at } };
    }
    return next;
  });

export const linkSubChat = (child: string, parent: string, via: SubVia, at = Date.now()) => linkSubChats([{ child, parent, via, at }]);

// Every session of id's chat: the root first, then its sub-chats oldest first.
export const groupOf = async (id: string) => {
  const root = await rootOf(id);
  return [root, ...(await childrenOf(root))];
};

// The round a sub-chat ran: the one recorded with its session id, else the last round that ended in its time span
// (from its start to the next sub-chat's), for rounds from before rounds kept their session id.
export function roundOf<R extends { at: number; sessionId?: string }>(id: string, members: { sessionId: string; startedAt: number }[], rounds: R[]) {
  const own = rounds.filter((r) => r.sessionId === id);
  if (own.length) return own[own.length - 1];
  const i = members.findIndex((m) => m.sessionId === id);
  if (i < 0) return undefined;
  const from = i === 0 ? -Infinity : members[i].startedAt;
  const to = members[i + 1]?.startedAt ?? Infinity;
  return rounds.filter((r) => !r.sessionId && r.at >= from && r.at < to).at(-1);
}
