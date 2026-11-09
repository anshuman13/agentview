import type { Account } from '../../../shared/protocol.js';

const CONFIG_DIR: Partial<Record<Account, string>> = { alt: '~/.claude-alt', alt2: '~/.claude-alt2' };
const shQuote = (s: string) => (/^[\w./~-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

// A shell line that continues the chat in the Claude CLI, on the same account.
export const claudeResume = (cwd: string, sessionId: string, account: Account) =>
  `cd ${shQuote(cwd)} && ${CONFIG_DIR[account] ? `CLAUDE_CONFIG_DIR=${CONFIG_DIR[account]} ` : ''}claude --resume ${sessionId}`;

export const codexResume = (cwd: string, sessionId: string) => `cd ${shQuote(cwd)} && codex resume ${sessionId}`;
