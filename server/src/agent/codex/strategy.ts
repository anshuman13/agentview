import type { ProviderStrategy } from '../types.js';
import { readMemory } from '../memory.js';
import { codexResume } from '../resume.js';
import { codexConnectors } from './connectors.js';
import { codexDriver } from './driver.js';
import { codexInstructionFiles } from './instructions.js';
import { codexMcpProbe, readCodexServers } from './mcp.js';
import { codexTranscript } from './threads.js';
import { codexFirstCommit, codexList, codexRead, searchRollouts } from './transcripts.js';

export const codexStrategy: ProviderStrategy = {
  driver: (_cwd, resume, fork) => codexDriver(resume, fork),
  verifyLimits: () => Promise.resolve(),
  transcripts: {
    path: codexTranscript,
    list: codexList,
    read: codexRead,
    tail: async () => '',
    search: (words, max) => searchRollouts(words, max),
    firstCommit: (id) => codexFirstCommit(id),
  },
  connectors: codexConnectors,
  memory: (cwd) => readMemory(codexInstructionFiles(cwd)),
  memoryDirs: () => [],
  resume: (cwd, sessionId) => codexResume(cwd, sessionId),
  mcpProbe: codexMcpProbe,
  servers: readCodexServers,
  serversFile: '~/.codex/config.toml',
  modelSet: 'codex',
  // The driver does not limit unattended chats yet.
  unattended: { limits: () => ({}) },
};
