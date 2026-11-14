import type { AgentEvent, LiveChat, ServerMessage } from '../../../shared/protocol.js';
import { gateSlugOf } from '../../../shared/builds.js';
import { notifyApproval } from '../integrations/notify.js';
import { firstSeen } from '../session/approvalSeen.js';
import { approvalOf } from '../session/builds.js';

const FRESH_MS = 60_000;
const started = new Set<string>();

// The approval gate agent starting while nobody views its chat pushes once per gate and chat, and tells the clients.
export async function announceApproval(chat: { id: string; cwd: string }, ev: AgentEvent, away: () => LiveChat | null, send: (m: ServerMessage) => void) {
  const slug = gateSlugOf(ev.description);
  if (!slug || ev.status !== 'running' || Date.now() - ev.startedAt > FRESH_MS || started.has(ev.toolUseId)) return;
  started.add(ev.toolUseId);
  if (started.size > 200) started.delete(started.values().next().value!);
  const live = away();
  const spec = live && (await approvalOf(chat.cwd, slug));
  if (!live || !spec || !(await firstSeen(`${chat.id}:${slug}:${spec.version}`))) return;
  if (notifyApproval(live, slug, spec.title, spec.body)) send({ type: 'approval', chat: chat.id, slug, title: spec.title });
}
