import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { errText } from '../../../../shared/util.js';
import { codexBin } from './binary.js';

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

export type RpcHandlers = {
  notification(method: string, params: any): void;
  // Answers a request the app-server makes of us (an approval); a throw becomes a JSON-RPC error.
  request(method: string, params: any): Promise<unknown>;
  exit(): void;
};

// JSON-RPC over the stdio of one `codex app-server` process, one message per line.
export class CodexRpc {
  private proc: ChildProcess;
  private next = 1;
  private pending = new Map<number, Pending>();
  private closed = false;

  constructor(cwd: string, private handlers: RpcHandlers) {
    this.proc = spawn(codexBin(), ['app-server'], { cwd, stdio: ['pipe', 'pipe', 'ignore'] });
    createInterface({ input: this.proc.stdout! }).on('line', (line) => this.onLine(line));
    this.proc.on('error', (err) => this.end(err));
    this.proc.on('exit', () => this.end(new Error('The codex process ended')));
    this.proc.stdin!.on('error', () => undefined);
  }

  static async open(cwd: string, handlers: RpcHandlers) {
    const rpc = new CodexRpc(cwd, handlers);
    try {
      await rpc.initialize();
    } catch (err) {
      rpc.close();
      throw err;
    }
    return rpc;
  }

  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'agentview', title: 'AgentView', version: '1' }, capabilities: null });
    this.send({ method: 'initialized' });
  }

  request<T = any>(method: string, params?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error('The codex process ended'));
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ id, method, ...(params !== undefined && { params }) });
    });
  }

  close() {
    this.end(new Error('The codex process was closed'), false);
    this.proc.kill();
  }

  private send(msg: object) {
    this.proc.stdin!.write(JSON.stringify(msg) + '\n');
  }

  private end(err: Error, report = true) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    if (report) this.handlers.exit();
  }

  private onLine(line: string) {
    let msg: { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.method && msg.id !== undefined) {
      const id = msg.id;
      this.handlers.request(msg.method, msg.params).then(
        (result) => this.send({ id, result }),
        (err) => this.send({ id, error: { code: -32601, message: errText(err) } }),
      );
    } else if (msg.method) this.handlers.notification(msg.method, msg.params);
    else if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p?.reject(new Error(msg.error.message ?? 'codex request failed'));
      else p?.resolve(msg.result);
    }
  }
}
