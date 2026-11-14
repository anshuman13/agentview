import { randomUUID } from 'node:crypto';
import { errText } from '../../../shared/util.js';
import type { AgentSession } from '../session/session.js';
import { openTries, firstSentence } from '../session/runs.js';
import { ROUND_INSTRUCTION } from '../session/repeat.js';
import { removeChat } from '../agent/claude/pins.js';
import { startTries, TRIES_USAGE, type parseTries } from '../workspace/tries.js';
import { closeByUser, openSaved, prompt } from './chats.js';
import { runs } from './listing.js';
import { bySession, live } from './state.js';

export function runTries(chat: AgentSession, text: string, tries: Exclude<ReturnType<typeof parseTries>, null>, id: string = randomUUID()) {
  chat.pushEvent({ id, kind: 'user', text, at: Date.now() });
  if (tries === 'usage') return chat.system(TRIES_USAGE);
  chat.system(`Starting ${tries.n} worktrees for this prompt`);
  const { provider, model } = chat.state.session;
  void startTries(chat.cwd, tries.n, tries.prompt, (cwd, p) => prompt(cwd, `${p}\n\n${ROUND_INSTRUCTION}`, chat.id, true, provider, model ?? undefined)).then(
    (started) => {
      runs.start({
        kind: 'tries',
        sessionId: chat.state.session.sessionId ?? '',
        chatId: chat.id,
        title: `Tries: ${firstSentence(tries.prompt, 70)}`,
        what: tries.prompt,
        provider: chat.state.session.provider,
        tries: started.map(({ id, branch }, i) => ({ n: i + 1, chatId: id, sessionId: live.get(id)?.chat.state.session.sessionId ?? '', branch })),
      });
      chat.system(`Started ${started.length} chats, one per tries/ branch; compare them with Open board on the loop card`);
    },
    (err) => chat.system(`Tries failed: ${errText(err)}`),
  );
}

export async function sendToTries(runId: string, text: string) {
  const run = runs.get(runId);
  if (!run || !text.trim()) return;
  await Promise.all(openTries(run).filter((t) => t.sessionId).map(async (t) => void (await openSaved(t.sessionId)).prompt(text)));
}

export async function keepTry(runId: string, n: number) {
  const run = runs.get(runId);
  if (!run?.tries?.some((t) => t.n === n)) return;
  for (const t of openTries(run).filter((t) => t.n !== n && t.sessionId)) {
    const chat = bySession(t.sessionId);
    if (chat) await closeByUser(chat);
    await removeChat(t.sessionId, false, true);
  }
  runs.keep(runId, n);
}
