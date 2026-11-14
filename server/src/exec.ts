export type ExecOptions = { cwd?: string; env?: Record<string, string | undefined>; timeout?: number; maxBuffer?: number; input?: string };
export type ExecError = Error & { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };

// Runs a command to its end. Rejects like Node's execFile: code is the exit code, or 'ENOENT' for a missing command,
// and killed is set when the timeout or maxBuffer stopped it.
export async function exec(cmd: string, args: string[], opts: ExecOptions = {}) {
  const proc = Bun.spawn([cmd, ...args], {
    cwd: opts.cwd,
    env: opts.env,
    stdin: opts.input === undefined ? 'ignore' : new Blob([opts.input]),
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: opts.timeout,
    maxBuffer: opts.maxBuffer ?? 1024 * 1024,
  });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  // Bun sets proc.killed after any exit; a signal is what tells a stopped command apart.
  const killed = proc.signalCode !== null;
  if (code === 0 && !killed) return { stdout, stderr };
  const why = killed ? `was stopped (${proc.signalCode})` : `failed with code ${code}`;
  throw Object.assign(new Error(`Command ${why}: ${[cmd, ...args].join(' ')}\n${stderr}`), { code: killed ? undefined : code, stdout, stderr, killed }) as ExecError;
}

// The same, blocking; for start-up checks that must answer before anything else runs.
export function execSync(cmd: string, args: string[], opts: Pick<ExecOptions, 'timeout' | 'maxBuffer'> = {}) {
  const r = Bun.spawnSync([cmd, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore', timeout: opts.timeout, maxBuffer: opts.maxBuffer });
  if (!r.success) throw Object.assign(new Error(`Command failed: ${cmd}`), { code: r.exitCode ?? undefined, killed: r.exitedDueToTimeout || r.exitedDueToMaxBuffer });
  return r.stdout.toString();
}

// Calls on with each line a long-running process prints; the last line counts even without a newline.
// Each chunk is searched once, so a long line costs no more than its length. A line past max is dropped and tooLong called.
export async function eachLine(stream: ReadableStream<Uint8Array>, on: (line: string) => void, max = Infinity, tooLong?: () => void) {
  const text = new TextDecoder();
  let parts: string[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const s = text.decode(chunk, { stream: true });
    let start = 0;
    for (let i; (i = s.indexOf('\n', start)) >= 0; start = i + 1) {
      parts.push(s.slice(start, i));
      on(parts.join(''));
      parts = [];
      size = 0;
    }
    if (start < s.length) {
      parts.push(s.slice(start));
      size += s.length - start;
    }
    if (size > max) {
      parts = [];
      size = 0;
      tooLong?.();
    }
  }
  if (parts.length) on(parts.join(''));
}

// Calls on with each piece of text a long-running process prints.
export async function eachChunk(stream: ReadableStream<Uint8Array>, on: (text: string) => void) {
  const text = new TextDecoder();
  for await (const chunk of stream) on(text.decode(chunk, { stream: true }));
}
