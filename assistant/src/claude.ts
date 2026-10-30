import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import type { Account } from '../../shared/protocol.js';
import { configDir, guardLimit, stopOnOverage } from '../../server/src/agent/claude/accounts.js';

// One run on the account, with no saved session or settings. It refuses at the usage limit and stops before extra usage.
export async function* ask(account: Account, prompt: string, options: Options) {
  guardLimit(account);
  const dir = configDir(account);
  const env = { ...process.env, ...options.env, ...(dir && { CLAUDE_CONFIG_DIR: dir }) };
  for await (const m of query({ prompt, options: { persistSession: false, settingSources: [], ...options, env } })) {
    stopOnOverage(account, m);
    yield m;
  }
}
