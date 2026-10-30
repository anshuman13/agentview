import { spawn, type ChildProcess } from 'node:child_process';

export type McpServerDef = { type?: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> };
export type McpTool = { name: string; description?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } };
type McpInfo = { name?: string; version?: string };
type McpContent = { type: string; text?: string; [k: string]: unknown };
export type McpResult = { content?: McpContent[]; structuredContent?: unknown; isError?: boolean };

type Env = Record<string, string | undefined>;

const expand = (s: string, env: Env) => s.replace(/\$\{([^}:]+)(?::-([^}]*))?\}/g, (m, k: string, d?: string) => env[k] ?? d ?? m);
const expandAll = (o: Record<string, string> | undefined, env: Env) => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, expand(v, env)]));

export function expandDef(def: McpServerDef, base: Env = process.env): McpServerDef {
  const env = expandAll(def.env, base);
  const all = { ...base, ...env };
  return { ...def, env, command: def.command && expand(def.command, all), args: def.args?.map((a) => expand(a, all)), url: def.url && expand(def.url, all), headers: expandAll(def.headers, all) };
}

const PROTOCOL = '2025-06-18';
const INIT = { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'agentview', version: '1' } };

const MAX_BUF = 8 * 1024 * 1024;

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

interface Transport {
  ready: Promise<void>;
  dead: boolean;
  info?: McpInfo;
  request(method: string, params: unknown, timeout: number): Promise<any>;
  stop(): void;
}

class Stdio implements Transport {
  private proc: ChildProcess;
  private pending = new Map<number, Pending>();
  private buf = '';
  private stderr = '';
  private nextId = 1;
  dead = false;
  info?: McpInfo;
  ready: Promise<void>;

  constructor(private key: string, def: McpServerDef, timeout: number, cwd?: string) {
    if (!def.command) throw new Error(`MCP server ${key} has no command`);
    this.proc = spawn(def.command, def.args ?? [], { cwd, env: { ...process.env, ...def.env }, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    this.proc.stdout!.setEncoding('utf8').on('data', (c: string) => this.onData(c));
    this.proc.stderr!.setEncoding('utf8').on('data', (c: string) => (this.stderr = (this.stderr + c).slice(-4000)));
    this.proc.stdin!.on('error', (err) => this.die(`${key} stdin failed: ${err.message}`));
    this.proc.on('error', (err) => this.die(`${key} failed to start: ${err.message}`));
    this.proc.on('exit', (code, signal) => this.die(`${key} exited (${code ?? signal})`));
    this.ready = this.request('initialize', INIT, timeout).then((r) => {
      this.info = r?.serverInfo;
      this.notify('notifications/initialized');
    });
    // A server that never finished starting is stopped, so the next call starts a fresh one.
    this.ready.catch(() => this.stop());
  }

  get pid() {
    return this.proc.pid;
  }

  private die(reason: string) {
    if (this.dead) return;
    this.dead = true;
    const err = new Error(this.stderr.trim() ? `${reason}: ${this.stderr.trim().split('\n').slice(-5).join('\n')}` : reason);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private onData(chunk: string) {
    this.buf += chunk;
    const lines = this.buf.split('\n');
    this.buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const p = typeof msg.id === 'number' ? this.pending.get(msg.id) : undefined;
      if (!p) continue;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
    if (this.buf.length > MAX_BUF) {
      this.buf = '';
      console.warn(`[mcp] ${this.key} sent over ${MAX_BUF} bytes without a newline, stopping it`);
      this.stop();
    }
  }

  private notify(method: string) {
    this.proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
  }

  request(method: string, params: unknown, timeout: number): Promise<any> {
    if (this.dead) return Promise.reject(new Error(`${this.key} is not running`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.key} ${method} timed out after ${timeout}ms${this.stderr.trim() ? `: ${this.stderr.trim().split('\n').at(-1)}` : ''}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', (err) => {
        if (!err) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  stop() {
    this.die(`${this.key} stopped`);
    try {
      process.kill(-this.proc.pid!, 'SIGTERM');
    } catch {
      this.proc.kill();
    }
  }
}

class Http implements Transport {
  private session = '';
  private nextId = 1;
  dead = false;
  info?: McpInfo;
  ready: Promise<void>;

  constructor(private key: string, private def: McpServerDef, timeout: number) {
    this.ready = this.request('initialize', INIT, timeout).then((r) => {
      this.info = r?.serverInfo;
      return this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, timeout).then(() => {});
    });
    this.ready.catch(() => (this.dead = true));
  }

  private async post(body: unknown, timeout: number) {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...this.def.headers };
    if (this.session) headers['mcp-session-id'] = this.session;
    try {
      const res = await fetch(this.def.url!, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
      if (res.status === 404 && this.session) {
        this.dead = true;
        throw new Error(`${this.key} session expired (HTTP 404)`);
      }
      if (res.status === 401 || res.status === 403) throw new Error(`${this.key} needs login (HTTP ${res.status})`);
      if (!res.ok) throw new Error(`${this.key} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const sid = res.headers.get('mcp-session-id');
      if (sid) this.session = sid;
      return { stream: !!res.headers.get('content-type')?.includes('text/event-stream'), text: await res.text() };
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') throw new Error(`${this.key} ${(body as { method: string }).method} timed out after ${timeout}ms`);
      throw err;
    }
  }

  async request(method: string, params: unknown, timeout: number): Promise<any> {
    const id = this.nextId++;
    const { stream, text } = await this.post({ jsonrpc: '2.0', id, method, params }, timeout);
    const payloads = stream
      ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim())
      : [text];
    for (const p of payloads) {
      if (!p) continue;
      let msg: any;
      try {
        msg = JSON.parse(p);
      } catch {
        continue;
      }
      if (msg?.id !== id) continue;
      if (msg.error) throw new Error(msg.error.message ?? JSON.stringify(msg.error));
      return msg.result;
    }
    throw new Error(`${this.key} sent no response for ${method}`);
  }

  stop() {
    this.dead = true;
  }
}

const clients = new Map<string, Transport>();

function client(key: string, def: McpServerDef, timeout: number, cwd?: string) {
  let c = clients.get(key);
  if (!c || c.dead) {
    c?.stop();
    const kind = def.type ?? (def.url ? 'http' : 'stdio');
    if (kind === 'sse') throw new Error(`MCP server ${key} uses SSE, which AgentView does not speak; use it from Claude`);
    const d = expandDef(def);
    c = kind === 'stdio' ? new Stdio(key, d, timeout, cwd) : new Http(key, d, timeout);
    clients.set(key, c);
  }
  return c;
}

async function call(key: string, def: McpServerDef, method: string, params: unknown, timeout: number, cwd?: string) {
  const c = client(key, def, timeout, cwd);
  await c.ready;
  return c.request(method, params, timeout);
}

export async function listTools(key: string, def: McpServerDef, timeout = 30_000): Promise<McpTool[]> {
  const r = await call(key, def, 'tools/list', {}, timeout);
  return r?.tools ?? [];
}

export async function callTool(key: string, def: McpServerDef, name: string, args: Record<string, unknown> = {}, timeout = 30_000, cwd?: string): Promise<McpResult> {
  const r = (await call(key, def, 'tools/call', { name, arguments: args }, timeout, cwd)) as McpResult;
  if (r?.isError) throw new Error(`${name}: ${text(r) || 'tool error'}`);
  return r;
}

export function text(r: McpResult) {
  return (r.content ?? []).filter((c) => c.type === 'text' && typeof c.text === 'string').map((c) => c.text as string).join('\n');
}

export function data(r: McpResult): unknown {
  if (r.structuredContent !== undefined) return r.structuredContent;
  const t = text(r).trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

export async function probe(key: string, def: McpServerDef, cwd?: string, timeout = 45_000): Promise<{ info?: McpInfo; tools: McpTool[] }> {
  const c = client(key, def, timeout, cwd);
  await c.ready;
  const r = await c.request('tools/list', {}, timeout);
  return { info: c.info, tools: r?.tools ?? [] };
}

export function pidOf(key: string) {
  const c = clients.get(key);
  return c instanceof Stdio ? c.pid : undefined;
}

export function stop(key: string) {
  clients.get(key)?.stop();
  clients.delete(key);
}

export function stopAll(prefix = '') {
  for (const key of [...clients.keys()]) if (key.startsWith(prefix)) stop(key);
}

process.on('exit', () => stopAll());
