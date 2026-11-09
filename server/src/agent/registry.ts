import path from 'node:path';
import type { Provider, ProviderOption } from '../../../shared/protocol.js';
import { providerLabel } from '../../../shared/providers.js';
import { readJsonSync, writeJsonSync } from '../json.js';
import { STATE_DIR, loggedInAccounts, verifyLimit } from './claude/accounts.js';
import { claudeTranscript } from './claude/chatMentions.js';
import { chatMemory } from './claude/memory.js';
import { claudeDriver } from './claude/driver.js';
import { NOT_SIGNED_IN, codexSignedIn } from './codex/binary.js';
import { codexDriver } from './codex/driver.js';
import { codexInstructionFiles } from './codex/instructions.js';
import { codexTranscript } from './codex/threads.js';
import { loadOpenRouter } from './claude/openrouter.js';
import { readMemory, type MemoryFile } from './memory.js';
import type { DriverFactory } from './types.js';

type Entry = {
  driver(cwd: string, resume?: string, fork?: boolean): DriverFactory;
  // Clears a limit mark the provider no longer deserves, so a chat does not start on a wrong one.
  verifyLimits(): Promise<unknown>;
  // The file that holds a chat's transcript, or null when this provider has no such chat.
  transcriptPath(id: string): string | null;
  // The instruction files the Memory list shows for a folder.
  memory(cwd: string): Promise<MemoryFile[]>;
};

const PROVIDERS: Record<Provider, Entry> = {
  claude: {
    driver: (cwd, resume, fork) => claudeDriver(cwd, resume, fork),
    verifyLimits: () => Promise.all(loggedInAccounts().map((a) => verifyLimit(a))),
    transcriptPath: claudeTranscript,
    memory: (cwd) => chatMemory(cwd),
  },
  openrouter: {
    driver: (cwd, resume, fork) => claudeDriver(cwd, resume, fork, true),
    verifyLimits: () => Promise.resolve(),
    transcriptPath: claudeTranscript,
    memory: (cwd) => chatMemory(cwd),
  },
  codex: {
    driver: (_cwd, resume, fork) => codexDriver(resume, fork),
    verifyLimits: () => Promise.resolve(),
    transcriptPath: codexTranscript,
    memory: (cwd) => readMemory(codexInstructionFiles(cwd)),
  },
};

// What a new chat can run on: OpenRouter once it has a key and models, Codex once this Mac is signed in to it.
export async function providerOptions(): Promise<ProviderOption[]> {
  const codex = await codexSignedIn();
  const enabled: Record<Provider, { on: boolean; note?: string }> = {
    claude: { on: true },
    openrouter: loadOpenRouter() ? { on: true } : { on: false, note: 'Set a key and models in Settings' },
    codex: codex ? { on: true } : { on: false, note: NOT_SIGNED_IN },
  };
  return (Object.keys(PROVIDERS) as Provider[]).map((id) => ({ id, label: providerLabel(id), enabled: enabled[id].on, ...(enabled[id].note && { note: enabled[id].note }) }));
}

export const provider = (id: Provider) => PROVIDERS[id];
export const isProvider = (v: unknown): v is Provider => typeof v === 'string' && v in PROVIDERS;

// The provider each chat was last on, so a reopened chat goes back to it; a chat not listed runs on Claude.
const FILE = path.join(STATE_DIR, 'chat-providers.json');
const chatProviders: Record<string, Provider> = readJsonSync<Record<string, Provider> | null>(FILE, null) ?? {};

export function rememberProvider(sessionId: string, p: Provider) {
  if ((chatProviders[sessionId] ?? 'claude') === p) return;
  chatProviders[sessionId] = p;
  try {
    writeJsonSync(FILE, chatProviders);
  } catch {}
}

export function providerOf(sessionId: string | undefined): Provider {
  const p = sessionId ? chatProviders[sessionId] : undefined;
  return p && p in PROVIDERS ? p : 'claude';
}

export const transcriptPath = (id: string) => provider(providerOf(id)).transcriptPath(id);
