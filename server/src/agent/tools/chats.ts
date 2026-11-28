import { z } from 'zod';
import { defineTool } from './tool.js';

export const chatSearchTool = defineTool({
  name: 'chat_search',
  description: 'Search only past chats (Claude and Codex) of this profile (not the wiki), ranked by keywords: chats holding more of the words come first. Returns title, folder, date, session id and a snippet.',
  schema: { query: z.string() },
  // Loaded on the call: search reaches the provider registry, which would make the tool list import the drivers that import it.
  handler: async ({ query }, { cwd, chatId }) => {
    const [{ searchChats }, { otherChats }] = await Promise.all([import('../claude/search.js'), import('../allChats.js')]);
    return searchChats(query, cwd, chatId, { others: otherChats });
  },
});
