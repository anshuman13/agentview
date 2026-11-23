import { describe, expect, test } from 'bun:test';
import os from 'node:os';
import { runCodeTool } from './runCode.js';

const ctx = { cwd: os.tmpdir(), chatId: null, provider: 'claude', host: {} } as never;

describe('run_code', () => {
  test('returns what the script prints and its exit', async () => {
    expect(await runCodeTool.handler({ code: 'console.log(typeof callMCPTool, listMCPServers().includes("nope"))' }, ctx)).toBe('function false');
    expect(await runCodeTool.handler({ code: 'throw new Error("boom")' }, ctx)).toContain('boom\n');
  });

  test('stops a script at its timeout', async () => {
    expect(await runCodeTool.handler({ code: 'await Bun.sleep(5000)', timeout: 1 }, ctx)).toBe('Stopped after 1 s.');
  });

  test('refuses unattended chats', async () => {
    expect(await runCodeTool.handler({ code: '1' }, { ...(ctx as object), unattended: true } as never)).toBe('An unattended chat cannot run code.');
  });
});
