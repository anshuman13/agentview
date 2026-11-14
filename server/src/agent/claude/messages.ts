import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ACCOUNT_LABEL, type Account } from '../../../../shared/protocol.js';
import type { AgentHost } from '../types.js';
import type { AssistantMessage, ToolResultBlock, UserMessage } from './sdkTypes.js';
import { limitReset } from './limitText.js';
import type { Rewinds } from './rewinds.js';
import type { TaskTracker } from './taskTracker.js';
import { agentResult, isAgent, patchAgent } from './subagents.js';
import { AGENT_TOOLS, ASYNC_LAUNCH, advisorEvent, agentEvent, liveReport, cacheFrom, contextFrom, noteLaunch, notificationResults, toolResultText } from './transcript.js';
import { toolUseEvent, clipResult, EDIT_TOOLS, editedPath } from '../steps.js';


// Turns the CLI's assistant and user messages into chat events.
export class Messages {
  private edits = new Map<string, string>();

  constructor(private host: AgentHost, private tasks: TaskTracker, private rewinds: Rewinds, private account: () => Account) {}

  // Edits whose results never came went with the old CLI.
  dropEdits() {
    this.edits.clear();
  }

  subagent(msg: AssistantMessage, parent: string) {
    const model = msg.message.model;
    if (model) patchAgent(this.host, parent, () => ({ model }));
    for (const block of msg.message.content) {
      if (block.type === 'text' && block.text.trim()) this.host.pushEvent({ id: randomUUID(), kind: 'assistant', text: block.text, streaming: false, at: Date.now(), parent });
      if (block.type === 'tool_use') this.toolUse(block, parent);
    }
  }

  assistant(msg: AssistantMessage) {
    const host = this.host;
    const { session } = host.state;
    host.setSession({ cache: cacheFrom(msg.message.usage, Date.now(), session.cache), context: contextFrom(msg.message.usage) ?? session.context });
    for (const block of msg.message.content) {
      if (block.type === 'server_tool_use' && block.name === 'advisor') host.pushEvent(advisorEvent(block.id, Date.now()));
      if (block.type === 'tool_use') this.toolUse(block);
      // The CLI marks its own usage-limit notice with error 'rate_limit'; Claude's replies never carry it.
      const until = block.type === 'text' && msg.error === 'rate_limit' ? limitReset(block.text) : null;
      if (until) host.limit(until);
      if (block.type === 'text' && msg.error === 'authentication_failed') host.system(`Logged out of the ${ACCOUNT_LABEL[this.account()]} Claude account (${block.text}). Run claude, then /login`);
    }
  }

  user(msg: UserMessage) {
    const parent = msg.parent_tool_use_id ?? undefined;
    const content = msg.message.content;
    if (!parent && this.rewinds.pending) this.rewinds.note(msg);
    if (typeof content === 'string' && content.startsWith('<task-notification>')) for (const ev of notificationResults(content, Date.now(), this.tasks.agents)) this.host.pushEvent(ev);
    if (!Array.isArray(content)) return;
    const output = (msg as { tool_use_result?: unknown }).tool_use_result;
    for (const block of content) {
      if (block.type === 'tool_result') this.toolResult(block, parent, output);
    }
  }

  private toolUse(block: { id: string; name: string; input: unknown }, parent?: string) {
    this.host.pushEvent(toolUseEvent(block.id, block.name, block.input, Date.now(), parent, this.tasks.agents));
    if (AGENT_TOOLS.has(block.name)) this.host.pushEvent(agentEvent(block.id, block.input, Date.now(), parent));
    const file = editedPath(block.input);
    if (EDIT_TOOLS.includes(block.name) && file) this.edits.set(block.id, file);
  }

  private toolResult(block: ToolResultBlock, parent: string | undefined, output: unknown) {
    const host = this.host;
    const edited = this.edits.get(block.tool_use_id);
    this.edits.delete(block.tool_use_id);
    if (edited && !block.is_error) host.noteFile(path.relative(host.cwd, edited), 'tool');
    const text = toolResultText(block);
    const agent = isAgent(host, block.tool_use_id);
    if (agent) agentResult(host, block.tool_use_id, text, Boolean(block.is_error), output);
    if (!parent && text.startsWith(ASYNC_LAUNCH)) {
      noteLaunch(this.tasks.agents, block.tool_use_id, text);
      return;
    }
    const report = agent ? liveReport(text, output) : clipResult(text);
    host.pushEvent({ id: randomUUID(), kind: 'tool_result', toolUseId: block.tool_use_id, text: report, isError: Boolean(block.is_error), at: Date.now(), ...(parent && { parent }) });
  }
}
