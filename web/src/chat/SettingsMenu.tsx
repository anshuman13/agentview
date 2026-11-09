import { notice, send, useStore } from '../app/store';
import { goalInfo, remindChoices, runLine, type GoalChoice } from './composer/composerLogic';
import { useChatRun } from '../sessions/runBands';
import { QuickPick } from '../ui/QuickPick';
import { ACCOUNT_LABEL } from '../../../shared/protocol';
import { copyChatMarkdown, copyResumeCommand, forkChat, remindChat, sideChat } from './chatActions';
import { useChatSettings, type Pick } from './ChatSettings';

type Props = { pick: Pick; setPick: (p: Pick | null) => void; close: () => void; savedCount: number; goal: GoalChoice };

export function SettingsMenu({ pick, setPick, close, savedCount, goal }: Props) {
  const { loop, review, modelName, effortName, modeInfo } = useChatSettings();
  const sessionId = useStore((s) => s.session.sessionId);
  const account = useStore((s) => s.session.account) ?? 'main';
  const accounts = useStore((s) => s.session.accounts) ?? [];
  const cwd = useStore((s) => s.session.cwd);
  const chat = useStore((s) => s.session.id);
  const hooks = useStore((s) => s.session.hooks) ?? [];
  const phase = useStore((s) => s.session.loop.phase);
  const run = useChatRun(chat);
  const act = (fn: () => void) => { fn(); close(); };
  const onPick = (v: string) => {
    if (v === 'side') return act(sideChat);
    if (v === 'review') return act(() => send({ type: 'set_review', on: !review }));
    if (v === 'fork') return act(forkChat);
    if (v === 'markdown') return act(copyChatMarkdown);
    if (v === 'terminal') return act(() => copyResumeCommand(cwd, sessionId!, account));
    setPick({ kind: v as Pick['kind'], at: pick.at });
  };
  return (
    <QuickPick
      anchor={pick.at}
      title="Chat settings"
      items={[
        { value: 'mode', label: 'Permission mode', detail: modeInfo.label },
        { value: 'review', label: 'Review each turn', detail: review ? 'On' : 'Off' },
        { value: 'model', label: 'Model', detail: modelName },
        { value: 'effort', label: 'Effort', detail: effortName },
        ...(accounts.length > 1 || account !== 'main' ? [{ value: 'account', label: 'Claude account', detail: ACCOUNT_LABEL[account] }] : []),
        { value: 'goal', label: 'Goal', detail: run ? runLine(run, phase) : goalInfo(goal, Date.now()).label },
        { value: 'loop', label: 'Build cycle', detail: loop.on ? `Up to ${loop.max} ${loop.max === 1 ? 'round' : 'rounds'}` : 'Off' },
        { value: 'saved', label: 'Saved prompts', detail: `${savedCount}` },
        { value: 'memory', label: 'Memory', detail: 'CLAUDE.md and memory files' },
        { value: 'hooks', label: 'Hooks', detail: hooks.length ? `${hooks.length}` : 'None' },
        { value: 'todos', label: 'TODOs', detail: 'TODO, FIXME and AI! comments in the repo' },
        { value: 'markdown', label: 'Copy as Markdown', detail: 'Prompts and replies loaded here' },
        ...(sessionId ? [{ value: 'side', label: 'Side chat', detail: 'Ask in a fork beside this chat (⌘;)' }, { value: 'remind', label: 'Remind me', detail: 'Add a task to check this chat later' }, { value: 'fork', label: 'Fork chat', detail: 'Start a new chat from a summary of this one' }, { value: 'terminal', label: 'Continue in terminal', detail: 'Copy a claude --resume command' }] : []),
      ]}
      onPick={onPick}
      onClose={close}
    />
  );
}

export function RemindPick({ pick, close }: { pick: Pick; close: () => void }) {
  return (
    <QuickPick
      anchor={pick.at}
      title="Remind me"
      items={remindChoices(Date.now()).map((c) => ({ value: String(c.at), label: c.label }))}
      onPick={(v) => { remindChat(Number(v)).then(() => notice('Reminder set'), () => notice('Could not set the reminder. Try again.')); close(); }}
      onClose={close}
    />
  );
}

export function HooksPick({ pick, close }: { pick: Pick; close: () => void }) {
  const hooks = useStore((s) => s.session.hooks) ?? [];
  return (
    <QuickPick
      anchor={pick.at}
      title="Hooks"
      items={hooks.length ? hooks.map((name) => ({ value: name, label: name })) : [{ value: '', label: 'No hooks for this repo' }]}
      onPick={(v) => { if (v) send({ type: 'run_hook', name: v }); close(); }}
      onClose={close}
    />
  );
}
