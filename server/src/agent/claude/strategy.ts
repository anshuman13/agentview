import type { ProviderStrategy, Transcripts } from '../types.js';
import { loggedInAccounts, verifyLimit } from './accounts.js';
import { claudeTranscript } from './chatMentions.js';
import { claudeDriver } from './driver.js';
import { allowedServers, mcpProbe } from './mcp.js';
import { chatMemory, memoryDirs } from './memory.js';
import { firstCommit, savedEvents } from './savedChat.js';
import { searchMessages } from './search.js';
import { fileTail, listSessions, savedSession } from './sessions.js';
import { claudeResume } from '../resume.js';

// One store for Claude and OpenRouter, so cross-provider callers see each chat once.
// Hoisted, since the registry builds the strategies while this module is still loading.
var shared: Transcripts | undefined;
function claudeTranscripts(): Transcripts {
  return (shared ??= {
    path: claudeTranscript,
    list: async () => (await listSessions({ limit: 1000 })).map((x) => savedSession(x)),
    read: savedEvents,
    tail: (id) => fileTail(claudeTranscript(id)),
    search: (words, max) => searchMessages(words.join(' '), undefined, max),
    firstCommit,
  });
}

// Claude, or OpenRouter through the same Claude Code driver and transcript store.
export function claudeStrategy({ openrouter = false } = {}): ProviderStrategy {
  return {
    driver: openrouter
      ? (cwd, resume, fork, unattended) => claudeDriver(cwd, { resume, fork, openrouter: true, unattended })
      : (cwd, resume, fork, unattended, account) => claudeDriver(cwd, { resume, fork, unattended, account, pinned: account != null }),
    verifyLimits: openrouter ? () => Promise.resolve() : () => Promise.all(loggedInAccounts().map((a) => verifyLimit(a))),
    transcripts: claudeTranscripts(),
    memory: (cwd) => chatMemory(cwd),
    memoryDirs: (cwd) => memoryDirs(cwd),
    resume: openrouter ? () => null : claudeResume,
    mcpProbe,
    servers: allowedServers,
    serversFile: '~/.claude.json',
    modelSet: 'claude',
  };
}
