export type SetupKind = 'observe' | 'deploy' | 'mcp';

// What the setup button asks the chat's agent for when a page has nothing set up.
export function setupPrompt(kind: SetupKind, repo: string, mcpCommand: string) {
  if (kind === 'observe') return `Set up Observe for ${repo}: use the Grafana MCP to find its dashboards and Loki selector, then save them as the Grafana settings for this repo.`;
  if (kind === 'deploy') return `Set up deploys for ${repo}: add a .deploy/app.yaml that names the app and its environments.`;
  return `Help me add an MCP server: run \`${mcpCommand}\` with the right arguments, then check the list again.`;
}
