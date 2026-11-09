import { z } from 'zod';
import { searchChats } from '../claude/search.js';
import { defineTool } from './tool.js';

export const chatSearchTool = defineTool({
  name: 'chat_search',
  description: 'Search only past Claude chats of this profile (not the wiki), ranked by keywords: chats holding more of the words come first. Returns title, folder, date, session id and a snippet.',
  schema: { query: z.string() },
  handler: ({ query }, { cwd, chatId }) => searchChats(query, cwd, chatId),
});
