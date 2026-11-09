import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { searchChats } from './search.js';

export function chatTools(o: { cwd: string; chat: () => string | null }) {
  return [
    tool('chat_search', 'Search only past Claude chats of this profile (not the wiki), ranked by keywords: chats holding more of the words come first. Returns title, folder, date, session id and a snippet.', { query: z.string() }, async ({ query }) => ({
      content: [{ type: 'text' as const, text: await searchChats(query, o.cwd, o.chat()) }],
    })),
  ];
}
