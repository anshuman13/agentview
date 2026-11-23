import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { configDir, freshAccount, stopOnOverage } from './accounts.js';
import { parseReceipt, RECEIPT_PROMPT, type ReceiptFields } from '../../../../shared/travel.js';

const TIMEOUT = 90_000;
const IMAGES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export const readable = (mime: string) => IMAGES.has(mime) || mime === 'application/pdf';

// Claude reads one receipt file (an image or a PDF) on the work account and returns what it found.
export async function readReceipt(file: string, mime: string): Promise<ReceiptFields> {
  const data = (await readFile(file)).toString('base64');
  const block = mime === 'application/pdf'
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: mime as 'image/jpeg', data } };
  async function* prompt(): AsyncGenerator<SDKUserMessage> {
    yield { type: 'user', parent_tool_use_id: null, session_id: '', message: { role: 'user', content: [block, { type: 'text', text: RECEIPT_PROMPT }] } };
  }
  const account = freshAccount(path.join(os.homedir(), 'workspace'));
  const dir = configDir(account);
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), TIMEOUT);
  try {
    const q = query({ prompt: prompt(), options: { model: 'sonnet', persistSession: false, settingSources: [], maxTurns: 1, tools: [], thinking: { type: 'disabled' }, abortController, env: { ...process.env, ...(dir && { CLAUDE_CONFIG_DIR: dir }) } } });
    for await (const m of q) {
      stopOnOverage(account, m);
      if (m.type === 'result') return m.subtype === 'success' ? parseReceipt(m.result) : {};
    }
    return {};
  } finally {
    clearTimeout(timer);
  }
}
