import type { Query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentHost } from '../types.js';
import { sessionUsage } from './usage.js';

export async function loadMeta(q: Query, host: AgentHost) {
  try {
    const [models, commands] = await Promise.all([q.supportedModels(), q.supportedCommands()]);
    host.setSession({
      models: [
        { value: 'team', displayName: 'Team: Opus plans, Sonnet builds', description: 'Opus plans each task, Sonnet 5.5 builds it with Opus advising. Fable only with your OK' },
        ...models.map((m) => ({ value: m.value, displayName: m.displayName, description: m.description })),
      ],
      commands: commands.map((c) => ({ name: c.name, description: c.description })),
    });
  } catch (err) {
    process.stderr.write(`loadMeta failed: ${String(err)}\n`);
  }
}

// The usage only counts while q is still the chat's process.
export async function loadUsage(q: Query, host: AgentHost, isCurrent: () => boolean) {
  try {
    const u = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
    if (isCurrent()) host.setSession({ usage: sessionUsage(u) });
  } catch (err) {
    process.stderr.write(`loadUsage failed: ${String(err)}\n`);
  }
}
