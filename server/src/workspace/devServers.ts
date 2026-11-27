import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type DevServer = { port: number; pid: number; name: string; cwd: string; startedAt: number };

// Processes that listen on a port but are not dev servers: the CLI's own MCP and IDE ports.
const SKIP = new Set(['claude', 'codex']);

type Proc = { pid: number; name: string; ports: number[] };

// lsof -F output: p<pid>, c<command>, n<address:port>, one field per line.
export function parseListeners(out: string): Proc[] {
  const procs = new Map<number, Proc>();
  let cur: Proc | undefined;
  for (const line of out.split('\n')) {
    const v = line.slice(1);
    if (line[0] === 'p') {
      const pid = Number(v);
      cur = procs.get(pid) ?? { pid, name: '', ports: [] };
      procs.set(pid, cur);
    } else if (line[0] === 'c' && cur) cur.name = v;
    else if (line[0] === 'n' && cur) {
      const port = Number(v.slice(v.lastIndexOf(':') + 1));
      if (port && !cur.ports.includes(port)) cur.ports.push(port);
    }
  }
  return [...procs.values()].filter((p) => p.ports.length && !SKIP.has(p.name));
}

export function parseCwds(out: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid = 0;
  for (const line of out.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1));
    else if (line[0] === 'n' && pid) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

// ps etime: [[dd-]hh:]mm:ss.
export function etimeSeconds(etime: string): number {
  const [days, rest] = etime.includes('-') ? etime.split('-') : ['0', etime];
  return rest.split(':').map(Number).reduce((s, n) => s * 60 + n, 0) + Number(days) * 86400;
}

export function parsePs(out: string): Map<number, { secs: number; args: string }> {
  const rows = new Map<number, { secs: number; args: string }>();
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
    if (m) rows.set(Number(m[1]), { secs: etimeSeconds(m[2]), args: m[3].slice(0, 400) });
  }
  return rows;
}

// A readable name: the node_modules bin (vite, next), python's -m module or script, else the executable.
export function serverName(args: string, scripts: Record<string, string> = {}): string {
  const words = args.split(/\s+/);
  const bin = args.match(/node_modules\/(?:\.bin\/([^/\s]+)|([^/\s.][^/\s]*)\/(?:bin|dist)\/)/);
  let name = bin?.[1] ?? bin?.[2];
  if (!name) {
    const exe = path.basename(words[0] ?? '');
    const m = words.indexOf('-m');
    if (/^python/i.test(exe)) name = m > 0 && words[m + 1] ? words[m + 1] : path.basename(words[1] ?? exe);
    else name = exe;
  }
  const script = Object.entries(scripts).find(([, cmd]) => cmd.split(/\s+/)[0] === name);
  return script ? `${script[0]} (${name})` : name;
}

export const inFolder = (cwd: string, folder: string) => {
  const root = folder.replace(/\/+$/, '');
  return cwd === root || cwd.startsWith(root + '/');
};

export function devServersFrom(folder: string, lsof: string, cwdOut: string, psOut: string, now: number, scripts: Record<string, Record<string, string>> = {}): DevServer[] {
  const cwds = parseCwds(cwdOut);
  const ps = parsePs(psOut);
  return parseListeners(lsof)
    .filter((p) => inFolder(cwds.get(p.pid) ?? '', folder))
    .flatMap((p) => {
      const row = ps.get(p.pid);
      const name = serverName(row?.args ?? p.name, scripts[cwds.get(p.pid)!]);
      return p.ports.map((port) => ({ port, pid: p.pid, name, cwd: cwds.get(p.pid)!, startedAt: row ? now - row.secs * 1000 : 0 }));
    })
    .filter((s, i, all) => all.findIndex((o) => o.port === s.port) === i)
    .sort((a, b) => a.port - b.port);
}

const text = (cmd: string, args: string[]) => run(cmd, args, { maxBuffer: 4_000_000 }).then((r) => r.stdout, (e) => (e as { stdout?: string }).stdout ?? '');

async function packageScripts(dir: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')).scripts ?? {};
  } catch {
    return {};
  }
}

// Read-only: lists what listens, never starts or stops a process.
export async function listDevServers(folder: string): Promise<DevServer[]> {
  const lsof = await text('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn']);
  const pids = parseListeners(lsof).map((p) => p.pid);
  if (!pids.length) return [];
  const [cwdOut, psOut] = await Promise.all([
    text('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', pids.join(',')]),
    text('ps', ['-ww', '-o', 'pid=,etime=,args=', '-p', pids.join(',')]),
  ]);
  const dirs = [...new Set([...parseCwds(cwdOut).values()].filter((d) => inFolder(d, folder)))];
  const scripts = Object.fromEntries(await Promise.all(dirs.map(async (d) => [d, await packageScripts(d)] as const)));
  return devServersFrom(folder, lsof, cwdOut, psOut, Date.now(), scripts);
}
