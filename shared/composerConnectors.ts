import type { McpServer } from './protocol';

export type ConnectorTone = 'ok' | 'bad' | 'warn' | 'wait' | 'off';
export type ConnectorRow = { name: string; label: string; tone: ConnectorTone; note: string; on: boolean };

const STATE: Record<string, [ConnectorTone, string]> = {
  connected: ['ok', ''],
  failed: ['bad', 'Failed'],
  'needs-auth': ['warn', 'Needs login'],
  pending: ['wait', 'Connecting'],
  disabled: ['off', 'Off'],
};

// The live chat's servers for the composer's Connectors list (Claude.app's + menu > Connectors), sorted by name.
export const composerConnectors = (mcp: McpServer[]): ConnectorRow[] =>
  mcp
    .map((s) => {
      const [tone, note] = STATE[s.status] ?? ['off', s.status];
      return { name: s.name, label: s.name.replace(/^claude\.ai /, ''), tone, note, on: s.status !== 'disabled' };
    })
    .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
