import type { Account } from '../../../shared/protocol.js';
import { type CallRow, saveCall } from './store.js';

export type CallMessage = {
  id?: string;
  model?: string;
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  } | null;
};

export function callRow(account: Account, chat: string | null, message: CallMessage, at: number, guessed = false): CallRow | null {
  const u = message.usage;
  if (!message.id || !u) return null;
  return {
    id: message.id,
    at,
    account,
    chat,
    model: message.model ?? null,
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    guessed,
  };
}

export function recordCall(account: Account, chat: string | null, message: CallMessage, at = Date.now()) {
  const row = callRow(account, chat, message, at);
  return row ? storeCall(row) : false;
}

export function storeCall(row: CallRow) {
  try {
    return saveCall(row);
  } catch (e) {
    console.error('[usage] could not store call', e);
    return false;
  }
}
