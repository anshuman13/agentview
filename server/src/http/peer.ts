import type { ServerWebSocket } from 'bun';

export const OPEN = 1;

// What the upgrade carried over from the HTTP request.
export type SocketData = { url: string; origin?: string; agent?: string; peer?: Peer };

// A browser's WebSocket to this server, with the event style terminal and Chrome code is written against.
export class Peer {
  private listeners = { message: [] as ((raw: string | Buffer) => void)[], close: [] as (() => void)[], pong: [] as (() => void)[] };
  // Send callbacks waiting for the socket to drain.
  private flushing: (() => void)[] = [];

  constructor(private ws: ServerWebSocket<SocketData>) {}

  get readyState() {
    return this.ws.readyState;
  }

  get bufferedAmount() {
    return this.ws.getBufferedAmount();
  }

  // done runs once the data has left for the socket, or the socket closed.
  send(data: string | Buffer, done?: () => void) {
    const sent = this.ws.send(data, data.length >= 1024);
    if (!done) return;
    if (sent === -1) this.flushing.push(done);
    else queueMicrotask(done);
  }

  close(code?: number, reason?: string) {
    this.ws.close(code, reason);
  }

  terminate() {
    this.ws.terminate();
  }

  ping() {
    this.ws.ping();
  }

  on(event: 'message', fn: (raw: string | Buffer) => void): void;
  on(event: 'close' | 'pong', fn: () => void): void;
  on(event: 'message' | 'close' | 'pong', fn: (raw: never) => void) {
    (this.listeners[event] as unknown[]).push(fn);
  }

  // Called by the server's websocket handlers.
  message(raw: string | Buffer) {
    for (const fn of this.listeners.message) fn(raw);
  }

  pong() {
    for (const fn of this.listeners.pong) fn();
  }

  drain() {
    if (this.ws.getBufferedAmount() > 0) return;
    for (const done of this.flushing.splice(0)) done();
  }

  closed() {
    for (const done of this.flushing.splice(0)) done();
    for (const fn of this.listeners.close) fn();
  }
}
