import os from 'node:os';
import path from 'node:path';
import type { Socket } from 'node:net';
import type { ChatRun, ClientMessage, LiveChat, Provider, ServerMessage } from '../../../shared/protocol.js';

// The agent host owns the chats and their Claude processes; the API server talks to it over this socket,
// so the API server can restart without ending a turn.
export const socketPath = (port: number | string) => path.join(os.homedir(), '.agentview', `host-${port}.sock`);

export type HostRequest =
  | { op: 'hello' }
  | { op: 'tool_call'; id: string; name: string; args: unknown }
  | { op: 'state'; id: string; limit?: number }
  | { op: 'events_before'; id: string; before: string; limit?: number }
  | { op: 'cmd'; id: string; msg: ClientMessage }
  | { op: 'open'; sessionId: string }
  | { op: 'new'; cwd: string; from: string; fork?: string; model?: string; provider?: Provider; text?: string }
  | { op: 'job'; cwd: string; title: string; prompt: string; jobId: string; branch: string; repo: string; paseo: boolean }
  | { op: 'run_end'; id: string; why: string; pr?: string }
  | { op: 'run_revise'; id: string; text: string }
  | { op: 'close'; id: string }
  | { op: 'rename'; sessionId: string; title: string }
  | { op: 'ask'; cwd: string; prompt: string; from?: string; fresh?: boolean }
  | { op: 'mcp_add'; id: string; name: string }
  | { op: 'mcp_login'; id: string; name: string }
  | { op: 'viewers'; counts: Record<string, number>; last: string }
  | { op: 'desktop'; at: number }
  | { op: 'restart'; now: boolean; force: boolean };

export type Hello = { last: string; restarting: boolean; chats: LiveChat[]; runs: ChatRun[] };

// Host to API: replies carry the request number; everything else is a broadcast, to one chat's viewers or to all.
export type HostLine = { n: number; ok: true; r: unknown } | { n: number; ok: false; error: string } | { chat: string | null; m: ServerMessage } | { closed: string };

// Newline-delimited JSON. Lines are handled synchronously in order, so a reply and the broadcasts after it keep their order.
export function lines(sock: Socket, on: (v: unknown) => void) {
  let buf = '';
  sock.setEncoding('utf8');
  sock.on('data', (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        on(JSON.parse(line));
      } catch (err) {
        console.error('host line:', err);
      }
    }
  });
  return (v: unknown) => sock.writable && (sock.write(`${JSON.stringify(v)}\n`), true);
}
