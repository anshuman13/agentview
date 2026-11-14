import path from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { buildSpecPrompt, isSpecPath } from '../../../../shared/specTasks.js';
import { allowedFolder } from '../../workspace/files.js';
import { defineTool } from './tool.js';

// An advisor chat runs outside the project, so it starts the build in a new chat in the project's folder.
export const buildTool = defineTool({
  name: 'start_build',
  description: 'Start the agentview:build workflow for a spec in a new chat in its project, the same as the Build action on the Advisors board. Use it from a chat whose folder is not the project.',
  schema: { spec: z.string().describe('Absolute path of the spec, <project>/.claude/specs/<slug>.md') },
  async handler({ spec }, { host }) {
    const root = path.resolve(spec, '../../..');
    if (!path.isAbsolute(spec) || !isSpecPath(spec) || !existsSync(spec) || !allowedFolder(root)) return `No spec at ${spec} in a project.`;
    if (!host.startChat) return 'This chat cannot start other chats.';
    return `Build started in chat ${await host.startChat(root, buildSpecPrompt(spec))}.`;
  },
});
