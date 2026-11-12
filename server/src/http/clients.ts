import { ROW_WINDOW, type ChatRun, type LiveChat, type ServerMessage } from '../../../shared/protocol.js';
import type { Host } from '../host/client.js';
import { attention } from '../integrations/attention.js';
import type { Ring } from './stream.js';
import { RingGate } from './ringGate.js';

export type Client = { send: (m: ServerMessage) => void; sendRaw: (data: string, id?: number) => void; view: string; waiting?: boolean; close?: () => void; phone?: boolean };

// What the host last told this process about its chats.
export type Live = { chats: Map<string, LiveChat>; runs: ChatRun[]; lastViewed: string; restarting: boolean };

export function createClients(host: Host, live: Live, ring: Ring, boot: number) {
  const clients = new Set<Client>();
  const gate = new RingGate(ring, (chat) => [...clients].some((c) => c.view === chat));

  // Clients get the last rounds of each run; GET /api/runs has them all.
  const runsMessage = (): ServerMessage => ({ type: 'runs', runs: live.runs.map((r) => ({ ...r, rounds: r.rounds.slice(-10) })) });

  // To every client, or to the viewers of one chat. Each broadcast gets an id so an event stream can resume.
  function broadcast(m: ServerMessage, chat: string | null = null) {
    const data = JSON.stringify(m);
    const id = gate.push(m.type === 'init' ? null : data, chat);
    for (const c of clients) if (!chat || (c.view === chat && !c.waiting)) c.sendRaw(data, id);
  }

  let viewersTimer: NodeJS.Timeout | null = null;
  function reportViewers() {
    viewersTimer ??= setTimeout(() => {
      viewersTimer = null;
      const counts: Record<string, number> = {};
      for (const c of clients) counts[c.view] = (counts[c.view] ?? 0) + 1;
      host.notify({ op: 'viewers', counts, last: live.lastViewed });
    }, 50);
  }

  // Broadcasts for the chat are held back until its state arrives; the host sends the state before any later broadcast.
  function view(client: Client, id: string) {
    const old = client.view;
    client.view = id;
    if (old !== id) gate.leave(old);
    gate.attach(id);
    client.waiting = true;
    live.lastViewed = id;
    reportViewers();
    // No chat open: the client gets the live list and opens one through a command.
    if (!id) return void (client.waiting = false);
    host.call({ op: 'state', id, limit: ROW_WINDOW }, (err, state) => {
      if (client.view !== id) return;
      client.waiting = false;
      if (err) return client.send({ type: 'error', text: err });
      client.send({ type: 'init', state: state as Extract<ServerMessage, { type: 'init' }>['state'], boot });
      host.notify({ op: 'cmd', id, msg: { type: 'mcp_status' } });
    });
  }

  // What a new connection gets once it views its chat: its wanted session reopened if the chat is another, then the live state.
  function greet(client: Client, chat: string, wanted: string | null) {
    // A phone coming back after its chat was idle-closed should get that chat back, not whatever was viewed last.
    if (wanted && live.chats.get(chat)?.sessionId !== wanted) host.req<string>({ op: 'open', sessionId: wanted }).then((c) => client.view === chat && view(client, c), () => {});
    client.send({ type: 'live', chats: [...live.chats.values()] });
    client.send(runsMessage());
    client.send({ type: 'attention', items: attention() });
    if (live.restarting) client.send({ type: 'restarting' });
  }

  return { clients, gate, runsMessage, broadcast, reportViewers, view, greet };
}
