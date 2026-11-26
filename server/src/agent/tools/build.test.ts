import { describe, expect, it } from 'bun:test';
import { callTool } from './index';

const ctx = (startBuild?: (cwd: string, line: string, from?: string | null) => Promise<string>) => ({ cwd: '/repo', chatId: 'c', provider: 'claude' as const, host: { setStatus() {}, phoneAlarm: async () => '', startBuild } });

describe('start_build', () => {
  it('opens a build chat with the /build line', async () => {
    const calls: string[][] = [];
    const out = await callTool('start_build', { request: 'add  dark\nmode', auto: true, until: '6:30' }, ctx(async (cwd, line) => (calls.push([cwd, line]), 'n1')));
    expect(calls).toEqual([['/repo', '/build auto until 6:30 add dark mode']]);
    expect(out).toContain('n1');
  });
  it('passes the calling chat', async () => {
    let caller: string | null | undefined;
    await callTool('start_build', { request: 'x' }, ctx(async (_, __, from) => ((caller = from), 'n')));
    expect(caller).toBe('c');
  });
  it('takes a spec relative to the folder or absolute', async () => {
    const lines: string[] = [];
    const host = ctx(async (_, line) => (lines.push(line), 'n'));
    await callTool('start_build', { spec: '/p/.claude/specs/x.md', folder: '/p' }, host);
    await callTool('start_build', { spec: 'notes.txt' }, host);
    expect(lines).toEqual(['/build .claude/specs/x.md']);
  });
  it('needs something to build', async () => {
    expect(await callTool('start_build', {}, ctx(async () => 'n'))).toBe('Give a request or a spec.');
  });
});
