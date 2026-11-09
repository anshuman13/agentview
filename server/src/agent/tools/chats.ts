import { z } from 'zod';
import { defineTool } from './tool.js';

export const chatSearchTool = defineTool({
  name: 'chat_search',
  description: 'Search only past Claude chats of this profile (not the wiki), ranked by keywords: chats holding more of the words come first. Returns title, folder, date, session id and a snippet.',
  schema: { query: z.string() },
  // Loaded on the call: search reaches the provider registry, which would make the tool list import the drivers that import it.
  handler: async ({ query }, { cwd, chatId }) => (await import('../claude/search.js')).searchChats(query, cwd, chatId),
});
