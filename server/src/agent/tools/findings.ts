import { z } from 'zod';
import { defineTool } from './tool.js';

// The session reads the call's input from the tool step, so the handler only acknowledges it.
export const findingsTool = defineTool({
  name: 'report_findings',
  description: 'Report the findings of a code review: one entry per problem, with the file and line it is on. Call it once when the review is done, with an empty list when there is nothing to report.',
  schema: {
    findings: z.array(
      z.object({
        file: z.string().describe('Path of the file, relative to the repo'),
        line: z.number().describe('Line the problem is on'),
        summary: z.string().describe('One sentence naming the problem'),
        failure_scenario: z.string().optional().describe('How it fails, in a sentence or two'),
        category: z.string().optional().describe('For example bug, security or performance'),
        verdict: z.string().optional(),
      }),
    ),
  },
  async handler({ findings }) {
    return `Recorded ${findings.length} finding${findings.length === 1 ? '' : 's'}.`;
  },
});
