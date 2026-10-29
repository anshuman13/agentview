import { api, notice } from '../app/store';
import { showChat } from '../ui/util';
import type { Call } from './mcpHelpers';

export const insert = (text: string) => {
  showChat();
  window.dispatchEvent(new CustomEvent('agentview:insert', { detail: { text } }));
};
export const use = (server: string, tool?: string) => {
  showChat();
  window.dispatchEvent(new CustomEvent('agentview:use', { detail: { server, tool } }));
};

export async function share(lead: string, text: string, file: string) {
  if (text.length <= 2000) return insert(`${lead}: ${text.slice(0, 300).trim()}${text.length > 300 ? '...' : ''} `);
  try {
    const r = await fetch(api(`/api/paste?name=${encodeURIComponent(file)}`), { method: 'POST', headers: { 'content-type': 'text/plain' }, body: text });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error);
    insert(`${lead}: [File: ${body.path}] `);
  } catch (err) {
    notice(`Could not attach the result: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export const cite = (c: Call) => share(`Earlier mcp__${c.server}__${c.tool} call ${c.result?.isError ? 'failed with' : 'returned'}`, c.result?.text ?? '', `${c.server}-${c.tool}.txt`);

export const post = (path: string, body?: unknown) =>
  fetch(api(path), { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
    .then((r) => r.json())
    .then((r) => { if (r?.error) throw new Error(r.error); return r; });

// The work Claude account is signed in to claude.ai in Chrome on the Mac, the personal one in Firefox.
export const openConnectors = (account?: string) =>
  post('/api/open', { url: 'https://claude.ai/settings/connectors', browser: account === 'alt' ? 'chrome' : 'firefox' }).catch((e) => notice(`Could not open claude.ai: ${e.message}`));
