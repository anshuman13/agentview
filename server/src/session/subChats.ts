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
