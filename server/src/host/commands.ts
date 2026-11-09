import type { ClientMessage } from '../../../shared/protocol.js';
import { errText } from '../../../shared/util.js';
import type { AgentSession } from '../session/session.js';
import { parseTries } from '../workspace/tries.js';
import { keepTry, runTries, sendToTries } from './tries.js';

type Msg<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;

const shortId = (id: unknown) => (typeof id === 'string' ? id.slice(0, 64) : undefined);

function promptCommand(chat: AgentSession, msg: Msg<'prompt'>) {
  if (typeof msg.text !== 'string') return;
  const id = shortId(msg.id);
  const tries = parseTries(msg.text);
  if (tries) return runTries(chat, msg.text, tries, id);
  // The composer sends steer to stop Claude; a prompt during a run (Fix, Compact) waits its turn.
  void chat.prompt(msg.text, id);
}

function queueCommand(chat: AgentSession, msg: Msg<'queue'>) {
  if (typeof msg.text === 'string') void chat.queueNext(msg.text, shortId(msg.id));
}

function sendNowCommand(chat: AgentSession, msg: Msg<'send_now'>) {
  if (typeof msg.id === 'string') void chat.sendNow(msg.id);
}

function steerCommand(chat: AgentSession, msg: Msg<'steer'>) {
  if (typeof msg.text === 'string') void chat.steer(msg.text, shortId(msg.id));
}

function planCommand(chat: AgentSession, msg: Msg<'plan'>) {
  if (!Array.isArray(msg.next)) return;
  chat.changePlan(msg.next.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().slice(0, 120)).slice(0, 12));
}

function runHookCommand(chat: AgentSession, msg: Msg<'run_hook'>) {
  if (typeof msg.name === 'string') chat.hooks.run(msg.name);
}

function loopCommand(chat: AgentSession, msg: Msg<'set_loop'>) {
  chat.setLoop(Boolean(msg.on), typeof msg.max === 'number' ? msg.max : undefined);
}

function setModelCommand(chat: AgentSession, msg: Msg<'set_model'>) {
  chat.setModel(msg.model).catch((err) => chat.system(`Could not set the model: ${errText(err)}`));
}

// Chat-level commands from a client. The ones whose failure the client should hear about return their promise.
export function command(chat: AgentSession, msg: ClientMessage): Promise<unknown> | void {
  switch (msg.type) {
    case 'prompt':
      return promptCommand(chat, msg);
    case 'queue':
      return queueCommand(chat, msg);
    case 'send_now':
      return sendNowCommand(chat, msg);
    case 'steer':
      return steerCommand(chat, msg);
    case 'plan':
      return planCommand(chat, msg);
    case 'answer':
      return void chat.approvals.answerQuestion(msg.id, msg.answers);
    case 'permission':
      return void chat.answerPermission(msg.id, msg.allow, msg.always);
    case 'run_hook':
      return runHookCommand(chat, msg);
    case 'retry':
      return chat.retryLast();
    case 'allow_blocked':
      return chat.allowBlocked(String(msg.id));
    case 'set_model':
      return setModelCommand(chat, msg);
    case 'set_effort':
      return chat.setEffort(String(msg.effort));
    case 'set_account':
      return void chat.setAccount(String(msg.account));
    case 'set_permission_mode':
      return void chat.setPermissionMode(msg.mode);
    case 'run':
      return chat.runControl(String(msg.run), msg.op);
    case 'tries_send':
      return sendToTries(msg.run, String(msg.text));
    case 'tries_keep':
      return keepTry(msg.run, Number(msg.n));
    case 'set_loop':
      return loopCommand(chat, msg);
    case 'interrupt':
      return void chat.interrupt();
    case 'rewind':
      return chat.rewind(String(msg.id));
    case 'stop_task':
      return chat.stopTask(String(msg.toolUseId));
    case 'mcp_status':
      return void chat.mcp.refresh();
    case 'usage':
      return void chat.refreshUsage();
    case 'mcp_reconnect':
      return void chat.mcp.reconnect(String(msg.name));
    case 'mcp_toggle':
      return void chat.mcp.toggle(String(msg.name), Boolean(msg.enabled));
  }
}
