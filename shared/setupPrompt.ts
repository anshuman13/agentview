export type SetupKind = 'deploy' | 'mcp';

// What the setup button asks the chat's agent for when a page has nothing set up.
export function setupPrompt(kind: SetupKind, repo: string, mcpCommand: string) {
  if (kind === 'deploy') return `Set up deploys for ${repo}: add a .deploy/app.yaml that names the app and its environments.`;
  return `Help me add an MCP server: run \`${mcpCommand}\` with the right arguments, then check the list again.`;
}
