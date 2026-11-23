import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { defineTool } from './tool.js';

const RUNNER = path.join(import.meta.dir, 'codeRunner.ts');
const MAX_OUT = 10_000;

export const RUN_CODE_RULES =
  'When an MCP tool would return a large result (logs, SQL rows, long lists) or a task needs many tool calls, loops or polling, use mcp__agentview__run_code: filter, join and count inside the script and print only what you need.';

export function clip(out: string, max = MAX_OUT) {
  return out.length <= max ? out : `${out.slice(0, max)}\n(output cut at ${max} characters; print less, filter in the script)`;
}

export const runCodeTool = defineTool({
  name: 'run_code',
  description: [
    "Run a TypeScript script with Bun in the chat's folder and return what it prints (stdout and stderr, cut at 10000 characters).",
    "The script can call the chat's MCP servers with these globals: listMCPServers(): string[]; listMCPTools(server): Promise<{ name, description, inputSchema }[]>; callMCPTool(server, tool, args): Promise<unknown> (parsed JSON when the tool returns JSON, else text; throws on a tool error).",
    'Top-level await works. Results stay in the script, so filter, join and count there and console.log only a short summary or a few rows, never a raw dump.',
    "When you do not know a result's shape, first print its keys or one item. Loops, retries and polling belong in the script.",
    'claude.ai connectors and servers that need an OAuth login are not reachable from here; call those tools directly.',
  ].join(' '),
  schema: { code: z.string(), timeout: z.number().int().min(1).max(600).optional().describe('Seconds before the script is stopped, default 120') },
  async handler({ code, timeout = 120 }, { cwd, unattended }) {
    if (unattended) return 'An unattended chat cannot run code.';
    const { allowedServers } = await import('../claude/mcp.js');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agentview-code-'));
    const file = path.join(dir, 'main.ts');
    try {
      await writeFile(file, code);
      const env = { ...process.env, AGENTVIEW_MCP: JSON.stringify(await allowedServers(cwd)) };
      const proc = Bun.spawn([process.execPath, RUNNER, file], { cwd, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
      // SIGTERM lets the runner stop the MCP servers it started; a script that ignores it is killed a few seconds later.
      let stopped = false;
      const term = setTimeout(() => ((stopped = true), proc.kill('SIGTERM')), timeout * 1000);
      const kill = setTimeout(() => proc.kill('SIGKILL'), timeout * 1000 + 5000);
      const [stdout, stderr, exit] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      clearTimeout(term);
      clearTimeout(kill);
      const out = [stdout, stderr].filter((s) => s.trim()).join('\n');
      const why = stopped ? `Stopped after ${timeout} s.` : exit !== 0 ? `Exited with code ${exit}.` : '';
      return clip([out.trimEnd(), why].filter(Boolean).join('\n') || '(no output)');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
});
