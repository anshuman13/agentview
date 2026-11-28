import type { ProviderStrategy } from '../types.js';
import { readMemory } from '../memory.js';
import { codexResume } from '../resume.js';
import { codexDriver } from './driver.js';
import { codexInstructionFiles } from './instructions.js';
import { codexMcpProbe, readCodexServers } from './mcp.js';
import { codexTranscript } from './threads.js';
import { codexList, codexRead } from './transcripts.js';

export const codexStrategy: ProviderStrategy = {
  driver: (_cwd, resume, fork) => codexDriver(resume, fork),
  verifyLimits: () => Promise.resolve(),
  transcripts: {
    path: codexTranscript,
    list: codexList,
    read: codexRead,
    tail: async () => '',
    search: async () => [],
    firstCommit: async () => null,
  },
  memory: (cwd) => readMemory(codexInstructionFiles(cwd)),
  memoryDirs: () => [],
  resume: (cwd, sessionId) => codexResume(cwd, sessionId),
  mcpProbe: codexMcpProbe,
  servers: readCodexServers,
  serversFile: '~/.codex/config.toml',
  modelSet: 'codex',
};
