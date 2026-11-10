type StoppedTask = { description: string; tool: string; runId?: string; scriptPath?: string };
export type Stopped = { midTurn: boolean; tasks: StoppedTask[] };

export const resumePrompt = ({ midTurn, tasks }: Stopped) => {
  const list = tasks.map((t) => `- ${t.tool}: ${t.description}${t.runId ? ` (run id ${t.runId})` : ''}${t.scriptPath ? ` (script ${t.scriptPath})` : ''}`).join('\n');
  const resume = list ? `\n\n${list}\n\nResume each Workflow by calling it again with resumeFromRunId set to its run id. Restart the other stopped tasks if they are still needed.` : '';
  return `The agent host restarted${list ? ', which ended the background work it was running' : ''}.${resume}${midTurn ? ' Carry on with the turn you were in.' : ''}`;
};
