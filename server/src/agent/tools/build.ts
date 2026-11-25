import path from 'node:path';
import { z } from 'zod';
import { isSpecPath } from '../../../../shared/specTasks.js';
import { defineTool } from './tool.js';

export const BUILD_RULES = [
  'When the user asks to build something task by task, overnight or until a time, start it with mcp__agentview__start_build instead of telling them to type /build.',
  'It opens a new chat in the project that writes a spec and builds its tasks one by one, each in a fresh context, committing without pushing. Without auto it waits for the user to approve the spec and stops on a blocked task; with until it finds more work for the goal until that time.',
].join(' ');

export const buildTool = defineTool({
  name: 'start_build',
  description: 'Start a build run in a new chat in a project: a spec, then its tasks one by one, each in a fresh context. The same as typing /build there.',
  schema: {
    request: z.string().optional().describe('What to build, as the user said it. Omit when spec is given.'),
    spec: z.string().optional().describe('An existing spec to build, .claude/specs/<slug>.md, relative to folder or absolute.'),
    folder: z.string().optional().describe("Absolute path of the project. Defaults to this chat's folder."),
    auto: z.boolean().optional().describe('true only when the user asked for no approval: skip blocked tasks instead of waiting.'),
    until: z.string().regex(/^\d{1,2}:\d{2}$/).optional().describe('Keep going and find more work for the goal until this local time, HH:MM.'),
  },
  async handler({ request, spec, folder, auto, until }, { cwd, host }) {
    if (!host.startBuild) return 'This chat cannot start builds.';
    const dir = path.resolve(folder ?? cwd);
    const rel = spec ? path.relative(dir, path.resolve(dir, spec)) : '';
    if (spec && !isSpecPath(rel)) return `No spec at ${spec} in ${dir}.`;
    const what = rel || request?.replace(/\s+/g, ' ').trim();
    if (!what) return 'Give a request or a spec.';
    const line = ['/build', auto && 'auto', until && `until ${until}`, what].filter(Boolean).join(' ');
    return `Build started in a new chat (${await host.startBuild(dir, line)}): ${line}`;
  },
});
