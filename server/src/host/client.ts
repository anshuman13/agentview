import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lines, socketPath, type HostLine, type HostRequest } from './protocol.js';

const MAIN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'main.ts');
type Reply = (error: string | null, r?: unknown) => void;
type Push = Exclude<HostLine, { n: number }>;

// The API server's link to the agent host. Starts the host when none answers, and reconnects when it restarts.
export class Host {
  connected = false;
  private send: ((v: unknown) => void) | null = null;
  private seq = 0;
  private waiting = new Map<number, Reply>();
  private spawned = 0;

  constructor(private port: number, private project: string, private on: { push: (l: Push) => void; up: () => void; down: () => void }) {
    this.connect();
  }

  // The reply runs synchronously in line order, so broadcasts after it on the socket come after it here too.
  call(req: HostRequest, reply: Reply = () => {}) {
    if (!this.send) return reply('The agent host is restarting, try again in a moment');
    const n = ++this.seq;
    this.waiting.set(n, reply);
    this.send({ n, ...req });
  }

  req<T = unknown>(req: HostRequest) {
    return new Promise<T>((ok, fail) => this.call(req, (err, r) => (err ? fail(new Error(err)) : ok(r as T))));
  }

  notify(req: HostRequest) {
    this.send?.({ n: 0, ...req });
  }

  private connect() {
    const sock = net.connect(socketPath(this.port));
    sock.on('connect', () => {
      this.send = lines(sock, (v) => {
        const l = v as HostLine;
        if ('n' in l) {
          const reply = this.waiting.get(l.n);
          this.waiting.delete(l.n);
          reply?.(l.ok ? null : l.error, l.ok ? l.r : undefined);
        } else this.on.push(l);
      });
      this.connected = true;
      this.on.up();
    });
    sock.on('error', () => {});
    sock.on('close', () => {
      const was = this.connected;
      this.connected = false;
      this.send = null;
      for (const reply of this.waiting.values()) reply('The agent host restarted, try again');
      this.waiting.clear();
      if (was) this.on.down();
      else if (Date.now() - this.spawned > 30_000) this.spawn();
      setTimeout(() => this.connect(), was ? 200 : 500);
    });
  }

  // Its own process group, so stopping or restarting the API server leaves the host and its Claude processes running.
  private spawn() {
    this.spawned = Date.now();
    const logs = path.join(os.homedir(), '.agentview', 'logs');
    mkdirSync(logs, { recursive: true });
    const log = openSync(path.join(logs, 'host.log'), 'a');
    spawn(process.execPath, [MAIN, this.project], { detached: true, stdio: ['ignore', log, log], env: { ...process.env, PORT: String(this.port) } }).unref();
  }
}
