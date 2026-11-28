import type { ProviderStrategy } from '../types.js';
import { loggedInAccounts, verifyLimit } from './accounts.js';
import { claudeTranscript } from './chatMentions.js';
import { claudeDriver } from './driver.js';
import { allowedServers, mcpProbe } from './mcp.js';
import { chatMemory, memoryDirs } from './memory.js';
import { firstCommit, savedEvents } from './savedChat.js';
import { claudeResume } from '../resume.js';

// Claude, or OpenRouter through the same Claude Code driver and transcript store.
export function claudeStrategy({ openrouter = false } = {}): ProviderStrategy {
  return {
    driver: openrouter
      ? (cwd, resume, fork, unattended) => claudeDriver(cwd, { resume, fork, openrouter: true, unattended })
      : (cwd, resume, fork, unattended, account) => claudeDriver(cwd, { resume, fork, unattended, account, pinned: account != null }),
    verifyLimits: openrouter ? () => Promise.resolve() : () => Promise.all(loggedInAccounts().map((a) => verifyLimit(a))),
    transcriptPath: claudeTranscript,
    savedEvents,
    firstCommit,
    memory: (cwd) => chatMemory(cwd),
    memoryDirs: (cwd) => memoryDirs(cwd),
    resume: openrouter ? () => null : claudeResume,
    mcpProbe,
    servers: allowedServers,
    serversFile: '~/.claude.json',
    modelSet: 'claude',
  };
}
