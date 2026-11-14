import { exec, type ExecError, type ExecOptions } from './exec.js';

// In its own module, so a test that mocks exec mocks this too.
// Runs a command for its output. A failure throws its stderr, or says the command is missing or timed out;
// an exit code in ok counts as success.
export async function execText(cmd: string, args: string[], opts: ExecOptions & { ok?: number[] } = {}) {
  try {
    return (await exec(cmd, args, opts)).stdout;
  } catch (err) {
    const e = err as ExecError;
    if (opts.ok?.includes(e.code as number)) return e.stdout ?? '';
    if (e.code === 'ENOENT') throw new Error(`${cmd} is not installed`);
    if (e.killed && opts.timeout) throw new Error(`${cmd} ${args[0]} timed out after ${Math.round(opts.timeout / 1000)}s`);
    throw new Error(e.stderr?.trim() || e.message);
  }
}
