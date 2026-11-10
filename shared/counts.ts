import { MCP_BAD, type McpServer } from './protocol.js';

export type SessionState = 'needs' | 'failed' | 'running' | 'done';
export type ChatTone = 'running' | 'needs' | 'failed' | 'warn' | 'idle';

// One live chat as the counts see it: its Sessions state, its header tone and whether its run needs the user.
export type CountChat = { id: string; state: SessionState | null; tone: ChatTone; runNeeds: boolean; agents: number };

export type CountsInput = {
  chats: CountChat[];
  viewing: string;
  attention: number;
  mcp: Pick<McpServer, 'name' | 'status'>[];
  hidden: Record<string, string>;
  needsYouRows: number;
  replyRows: number;
};

const service = (name: string) => (name.search(/[_-]/) > 0 ? name.slice(0, name.search(/[_-]/)) : name);

export const shownMcp = <T extends { name: string }>(mcp: T[], hidden: Record<string, string>) => mcp.filter((m) => hidden[`hide:${service(m.name)}`] !== 'hidden');

export const chatBucket = (c: Pick<CountChat, 'tone' | 'runNeeds'>) => (c.tone === 'needs' || c.runNeeds ? 'waiting' : c.tone === 'running' ? 'running' : null);

// Every badge number in the app, from the chats, the MCP servers and the row counts the Codex logic gives.
export function appCounts(i: CountsInput) {
  const buckets = i.chats.map(chatBucket);
  const servers = shownMcp(i.mcp, i.hidden);
  return {
    needsYou: i.needsYouRows + i.replyRows,
    chats: i.chats.filter((c) => c.id !== i.viewing && (c.state === 'needs' || c.state === 'done')).length + i.attention,
    waiting: buckets.filter((b) => b === 'waiting').length,
    running: buckets.filter((b) => b === 'running').length,
    agents: i.chats.find((c) => c.id === i.viewing)?.agents ?? 0,
    mcp: { connected: servers.filter((m) => m.status === 'connected').length, total: servers.length, needsYou: servers.filter((m) => MCP_BAD.includes(m.status)).length },
  };
}

export type AppCounts = ReturnType<typeof appCounts>;
