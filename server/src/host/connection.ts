import type { Socket } from 'node:net';
import { errText } from '../../../shared/util.js';
import { apis, get, hub } from './state.js';
import { lines } from '../socket.js';
import type { HostRequest } from './protocol.js';

// The state of a chat is sent before any later broadcast for it, since replies and broadcasts share one ordered socket.
export const connection = (handle: (req: HostRequest) => Promise<unknown>) => (sock: Socket) => {
  let api = false;
  const send = lines(sock, (v) => {
    const { n, ...req } = v as HostRequest & { n: number };
    const fail = (err: unknown) => n && send({ n, ok: false, error: errText(err) });
    // Answered at once, not after an await, so no broadcast for the chat can slip in between.
    if (req.op === 'state') {
      try {
        send({ n, ok: true, r: get(req.id).view(req.limit) });
      } catch (err) {
        fail(err);
      }
      return;
    }
    // Only the API server says hello. A tool call comes on a socket of its own that must not receive broadcasts.
    if (req.op === 'hello') {
      api = true;
      apis.add(send);
    }
    handle(req).then((r) => n && send({ n, ok: true, r: r ?? null }), fail);
  });
  sock.on('close', () => {
    if (!api) return;
    apis.delete(send);
    // Without an API server nobody is watching; stale counts would hold back the phone notifications.
    if (!apis.size) hub.counts = {};
  });
  sock.on('error', () => {});
};
