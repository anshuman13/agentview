import type { Query } from '@anthropic-ai/claude-agent-sdk';
import { SKETCH_COMMAND } from '../../../../shared/sketches.js';
import type { AgentHost } from '../types.js';
import { sessionUsage } from './usage.js';

export async function loadMeta(q: Query, host: AgentHost, extraModels: Array<{ value: string; displayName: string; description?: string }>) {
  try {
    const [models, commands] = await Promise.all([q.supportedModels(), q.supportedCommands()]);
    host.setSession({
      models: [
        ...models.map((m) => ({ value: m.value, displayName: m.displayName, description: m.description })),
        ...extraModels,
      ],
      commands: [...commands.map((c) => ({ name: c.name, description: c.description })), SKETCH_COMMAND],
    });
  } catch (err) {
    process.stderr.write(`loadMeta failed: ${String(err)}\n`);
  }
}

// The usage only counts while q is still the chat's process.
// Plan usage belongs to the account, so the chats on one account share one read a minute.
const USAGE_TTL = 60_000;
const reads = new Map<string, { at: number; read: ReturnType<Query['usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET']> }>();

export async function loadUsage(q: Query, host: AgentHost, isCurrent: () => boolean, account: string, now = Date.now()) {
  try {
    let hit = reads.get(account);
    if (!hit || now - hit.at >= USAGE_TTL) {
      const fresh = { at: now, read: q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }) };
      fresh.read.catch(() => reads.get(account) === fresh && reads.delete(account));
      reads.set(account, (hit = fresh));
    }
    const u = await hit.read;
    if (isCurrent()) host.setSession({ usage: sessionUsage(u) });
  } catch (err) {
    process.stderr.write(`loadUsage failed: ${String(err)}\n`);
  }
}
