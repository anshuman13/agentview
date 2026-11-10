import { notice } from '../app/store';
import { showChat } from '../ui/util';
import { errText } from '../../../shared/util';
import type { Call } from './mcpHelpers';
import { openUrl, pasteText } from './opsApi';

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
    const body = await pasteText(file, text);
    insert(`${lead}: [File: ${body.path}] `);
  } catch (err) {
    notice(`Could not attach the result: ${errText(err)}`);
  }
}

export const cite = (c: Call) => share(`Earlier mcp__${c.server}__${c.tool} call ${c.result?.isError ? 'failed with' : 'returned'}`, c.result?.text ?? '', `${c.server}-${c.tool}.txt`);

// The work Claude accounts are signed in to claude.ai in Chrome on the Mac, the personal one in Firefox.
export const openConnectors = (account?: string) =>
  openUrl('https://claude.ai/settings/connectors', account && account !== 'main' ? 'chrome' : 'firefox').catch((e) => notice(`Could not open claude.ai: ${e.message}`));
