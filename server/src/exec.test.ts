import { describe, expect, it } from 'bun:test';
import { eachLine, exec, execSync } from './exec.js';

describe('exec', () => {
  it('resolves with the output of a command that succeeds', async () => {
    expect(await exec('sh', ['-c', 'echo out; echo err >&2'])).toEqual({ stdout: 'out\n', stderr: 'err\n' });
    expect((await exec('cat', [], { input: 'piped' })).stdout).toBe('piped');
  });

  it('rejects with the exit code and output of a command that fails', async () => {
    const err = await exec('sh', ['-c', 'echo partial; echo bad >&2; exit 3']).catch((e) => e);
    expect(err).toMatchObject({ code: 3, stdout: 'partial\n', stderr: 'bad\n', killed: false });
  });

  it('marks a timed-out command as killed and a missing one as ENOENT', async () => {
    expect(await exec('sleep', ['5'], { timeout: 100 }).catch((e) => e)).toMatchObject({ killed: true });
    expect(await exec('/nonexistent/cmd', []).catch((e) => e)).toMatchObject({ code: 'ENOENT' });
  });

  it('runs blocking, and throws on failure', () => {
    expect(execSync('echo', ['hi'])).toBe('hi\n');
    expect(() => execSync('false', [])).toThrow();
  });

  it('splits lines across chunks and drops one past the cap', async () => {
    const split = async (max: number, ...chunks: string[]) => {
      const bytes = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({ start: (c) => (chunks.forEach((s) => c.enqueue(bytes.encode(s))), c.close()) });
      const got: string[] = [];
      let long = 0;
      await eachLine(stream, (l) => got.push(l), max, () => long++);
      return { got, long };
    };
    expect(await split(Infinity, 'a\nb', 'c\n', 'd')).toEqual({ got: ['a', 'bc', 'd'], long: 0 });
    expect(await split(3, 'ab', 'cd', 'e\nx\n')).toEqual({ got: ['e', 'x'], long: 1 });
  });
});
