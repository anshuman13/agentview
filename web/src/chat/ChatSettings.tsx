import { embedded, getState, notice, prompt, send, setUi, subscribe, useStore } from '../app/store';
import { copyText } from '../ui/util';
import { chatMarkdown, goalChoices, handoffText, goalInfo, remindChoices, replyNote, resumeCommand, runLine, type GoalChoice } from './composerLogic';
import { useChatRun } from '../sessions/runBands';
import { assistantStore } from '../codex/data';
import { QuickPick } from '../ui/QuickPick';
import { MemoryPick } from './Memory';
import { TodosPick } from './Todos';
import { ACCOUNT_LABEL, ACCOUNT_NOTE, EFFORT_LABEL, EFFORT_LEVELS, PERMISSION_MODES } from '../../../shared/protocol';

const MODES: Record<string, { label: string; detail: string; icon: string }> = {
  default: { label: 'Default', detail: 'Ask before edits and risky commands', icon: 'shield' },
  acceptEdits: { label: 'Accept edits', detail: 'Edit files without asking, ask for the rest', icon: 'edit' },
  plan: { label: 'Plan', detail: 'Read and plan, no edits', icon: 'eye' },
  auto: { label: 'Auto', detail: 'Claude runs what is safe and asks only for risky actions', icon: 'zap' },
  dontAsk: { label: "Don't ask", detail: 'Deny anything not pre-approved', icon: 'circle-slash' },
};

const LOOP_ITEMS = [
  { value: 'off', label: 'Off', detail: 'Prompts run as usual' },
  ...[1, 2, 3, 5].map((n) => ({ value: String(n), label: `Up to ${n} ${n === 1 ? 'round' : 'rounds'}`, detail: 'Opus plans and builds, Sonnet tests and reports, Opus fixes what fails' })),
];

// Side chat (like Claude desktop's): forks this chat into the column beside it, so a question does not land in the
// running chat. The server views the fork once it starts; the original moves back to the main column.
export function sideChat() {
  const { id, sessionId } = getState().session;
  if (!sessionId || embedded) return;
  send({ type: 'new_session', fork: sessionId });
  const stop = subscribe(() => {
    const now = getState().session.id;
    if (!now || now === id) return;
    stop();
    send({ type: 'view', id });
    setUi({ beside: now });
  });
  setTimeout(stop, 30_000);
}

// Fork chat: a new chat in the same folder and model that starts by summarising this one.
export function forkChat() {
  const { id, sessionId, model } = getState().session;
  if (!sessionId) return;
  send({ type: 'new_session', ...(model && { model }) });
  const stop = subscribe(() => {
    const now = getState().session.id;
    if (!now || now === id) return;
    stop();
    prompt(handoffText(sessionId), () => notice('The summary was not requested. Try Fork chat again.'));
  });
  setTimeout(stop, 30_000);
}

// A task "Check <chat>" due at the picked time, linked to the chat; the hub pushes it when due.
async function remindChat(at: number) {
  const st = getState();
  const { sessionId, cwd } = st.session;
  if (!sessionId) return;
  const title = st.live.find((c) => c.id === st.session.id)?.title || 'chat';
  const { profile } = replyNote('', title, cwd);
  const store = assistantStore();
  const row = await store.capture(`Check ${title}`, 'task', profile, at);
  await store.update(row, { source: 'chat', source_url: `${location.origin}/?session=${sessionId}` });
}

export type Pick = { kind: 'menu' | 'model' | 'effort' | 'account' | 'mode' | 'loop' | 'goal' | 'saved' | 'mcp' | 'mcpTools' | 'memory' | 'remind' | 'todos'; at: DOMRect; server?: string };

export function useChatSettings() {
  const mode = useStore((s) => s.session.permissionMode) ?? 'default';
  const model = useStore((s) => s.session.model);
  const models = useStore((s) => s.session.models);
  const effort = useStore((s) => s.session.effort);
  const team = useStore((s) => s.session.team);
  const loop = useStore((s) => s.session.loop);
  const modelName = team ? 'Team' : models.find((m) => m.value === (model ?? 'default'))?.displayName ?? model ?? 'Default';
  const effortName = effort ? EFFORT_LABEL[effort] : 'Default';
  const modeInfo = MODES[mode] ?? { label: mode, detail: mode, icon: 'shield' };
  return { mode, model, models, effort, team, loop, modelName, effortName, modeInfo };
}

// The chat settings menu and the pickers it opens; the saved prompt and MCP pickers stay with the composer.
export function ChatSettings({ pick, setPick, savedCount, goal, setGoal }: { pick: Pick | null; setPick: (p: Pick | null) => void; savedCount: number; goal: GoalChoice; setGoal: (g: GoalChoice) => void }) {
  const { mode, model, models, effort, team, loop, modelName, effortName, modeInfo } = useChatSettings();
  const sessionId = useStore((s) => s.session.sessionId);
  const account = useStore((s) => s.session.account) ?? 'main';
  const accounts = useStore((s) => s.session.accounts) ?? [];
  const cwd = useStore((s) => s.session.cwd);
  const chat = useStore((s) => s.session.id);
  const phase = useStore((s) => s.session.loop.phase);
  const run = useChatRun(chat);
  if (!pick) return null;
  const close = () => setPick(null);
  return (
    <>
      {pick.kind === 'menu' && (
        <QuickPick
          anchor={pick.at}
          title="Chat settings"
          items={[
            { value: 'mode', label: 'Permission mode', detail: modeInfo.label },
            { value: 'model', label: 'Model', detail: modelName },
            { value: 'effort', label: 'Effort', detail: effortName },
            ...(accounts.length > 1 || account !== 'main' ? [{ value: 'account', label: 'Claude account', detail: ACCOUNT_LABEL[account] }] : []),
            { value: 'goal', label: 'Goal', detail: run ? runLine(run, phase) : goalInfo(goal, Date.now()).label },
            { value: 'loop', label: 'Build cycle', detail: loop.on ? `Up to ${loop.max} ${loop.max === 1 ? 'round' : 'rounds'}` : 'Off' },
            { value: 'saved', label: 'Saved prompts', detail: `${savedCount}` },
            { value: 'memory', label: 'Memory', detail: 'CLAUDE.md and memory files' },
            { value: 'todos', label: 'TODOs', detail: 'TODO, FIXME and AI! comments in the repo' },
            { value: 'markdown', label: 'Copy as Markdown', detail: 'Prompts and replies loaded here' },
            ...(sessionId ? [{ value: 'side', label: 'Side chat', detail: 'Ask in a fork beside this chat (⌘;)' }, { value: 'remind', label: 'Remind me', detail: 'Add a task to check this chat later' }, { value: 'fork', label: 'Fork chat', detail: 'Start a new chat from a summary of this one' }, { value: 'terminal', label: 'Continue in terminal', detail: 'Copy a claude --resume command' }] : []),
          ]}
          onPick={(v) => {
            if (v === 'side') { sideChat(); close(); return; }
            if (v === 'fork') { forkChat(); close(); return; }
            if (v === 'markdown') {
              const st = getState();
              copyText(chatMarkdown(st.events, st.live.find((c) => c.id === st.session.id)?.title ?? '')).then(() => notice('Copied the chat as Markdown'), () => notice('Could not copy'));
              close();
              return;
            }
            if (v === 'terminal') {
              copyText(resumeCommand(cwd, sessionId!, account)).then(() => notice('Copied. Stop this chat before resuming it in a terminal'), () => notice('Could not copy'));
              close();
              return;
            }
            setPick({ kind: v as 'mode' | 'model' | 'effort' | 'account' | 'loop' | 'goal' | 'saved' | 'memory' | 'remind' | 'todos', at: pick.at });
          }}
          onClose={close}
        />
      )}
      {pick.kind === 'remind' && (
        <QuickPick
          anchor={pick.at}
          title="Remind me"
          items={remindChoices(Date.now()).map((c) => ({ value: String(c.at), label: c.label }))}
          onPick={(v) => { remindChat(Number(v)).then(() => notice('Reminder set'), () => notice('Could not set the reminder. Try again.')); close(); }}
          onClose={close}
        />
      )}
      {pick.kind === 'todos' && <TodosPick anchor={pick.at} onClose={close} />}
      {pick.kind === 'memory' && <MemoryPick anchor={pick.at} cwd={cwd} onClose={close} />}
      {pick.kind === 'model' && (
        <QuickPick
          anchor={pick.at}
          title="Select model"
          current={team ? 'team' : model}
          items={models.map((m) => ({ value: m.value, label: m.displayName, detail: m.description }))}
          onPick={(v) => { send({ type: 'set_model', model: v }); close(); }}
          onClose={close}
        />
      )}
      {pick.kind === 'effort' && (
        <QuickPick
          anchor={pick.at}
          title="Select effort"
          current={effort}
          items={EFFORT_LEVELS.map((e) => ({ value: e, label: EFFORT_LABEL[e] }))}
          onPick={(v) => { send({ type: 'set_effort', effort: v }); close(); }}
          onClose={close}
        />
      )}
      {pick.kind === 'account' && (
        <QuickPick
          anchor={pick.at}
          title="Select Claude account"
          current={account}
          items={accounts.map((a) => ({ value: a, label: ACCOUNT_LABEL[a], detail: ACCOUNT_NOTE[a] }))}
          onPick={(v) => { send({ type: 'set_account', account: v }); close(); }}
          onClose={close}
        />
      )}
      {pick.kind === 'loop' && (
        <QuickPick
          anchor={pick.at}
          title="Build cycle"
          current={loop.on ? String(loop.max) : 'off'}
          items={LOOP_ITEMS}
          onPick={(v) => { send(v === 'off' ? { type: 'set_loop', on: false } : { type: 'set_loop', on: true, max: Number(v) }); close(); }}
          onClose={close}
        />
      )}
      {pick.kind === 'goal' && (
        <QuickPick
          anchor={pick.at}
          title="Goal"
          current={goal}
          items={goalChoices(Date.now()).map((c) => ({ value: c.value, label: c.label, detail: c.detail }))}
          onPick={(v) => {
            if (v === 'off' && run) send({ type: 'run', run: run.id, op: 'stop' });
            setGoal(v as GoalChoice);
            close();
          }}
          onClose={close}
        />
      )}
      {pick.kind === 'mode' && (
        <QuickPick
          anchor={pick.at}
          title="Permission mode"
          current={mode}
          items={PERMISSION_MODES.map((m) => ({ value: m, label: MODES[m]?.label ?? m, detail: MODES[m]?.detail }))}
          onPick={(v) => { send({ type: 'set_permission_mode', mode: v }); close(); }}
          onClose={close}
        />
      )}
    </>
  );
}
