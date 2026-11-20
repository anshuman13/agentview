import { notice, send, setUi, useStore } from '../app/store';
import { remindChoices } from './composer/composerLogic';
import { runLine } from '../sessions/runLogic';
import { useChatRun } from '../sessions/useChatRun';
import { openGoal, startGoal } from '../sessions/goalLogic';
import { QuickPick } from '../ui/QuickPick';
import { Section } from '../ui/Section';
import { Sheet } from '../ui/Sheet';
import { useNarrow } from '../app/shell/useNarrow';
import { ACCOUNT_LABEL } from '../../../shared/protocol';
import { Confirm } from '../ui/Confirm';
import { copyChatMarkdown, copyResumeCommand, forkChat, rememberChat, remindChat, sideChat } from './chatActions';
import { ruleFile } from './cards/Memory';
import { useChatSettings, type Pick } from './ChatSettings';
import { useCan } from './useCan';
import { ChoicePick, SheetRows } from './SettingsPickers';

type Props = { pick: Pick; setPick: (p: Pick | null) => void; close: () => void };

export function SettingsMenu({ pick, setPick, close }: Props) {
  const { menu, modelName, effortName } = useChatSettings();
  const resumeCommand = useStore((s) => s.session.resumeCommand);
  const canEffort = useCan('effort');
  const sessionId = useStore((s) => s.session.sessionId);
  const account = useStore((s) => s.session.account) ?? 'main';
  const accounts = useStore((s) => s.session.accounts) ?? [];
  const chat = useStore((s) => s.session.id);
  const buildFlow = useStore((s) => Boolean(s.session.buildFlow));
  const run = useChatRun(chat);
  const act = (fn: () => void) => { fn(); close(); };
  const onPick = (v: string) => {
    // Loops, tries and jobs have their controls on the loop card only.
    if (v === 'goal') return act(() => (!run ? startGoal({ here: true }) : run.kind === 'goal' && openGoal(run.id)));
    setPick({ kind: v as Pick['kind'], at: pick.at });
  };
  const narrow = useNarrow();
  const picker = (value: string, label: string, detail: string) => ({ value, label, detail, picker: true });
  const action = (value: string, label: string, detail: string) => ({ value, label, detail, picker: false });
  const groups = [
    ['Run', [
      picker('mode', 'Permission mode', menu.label),
      picker('model', 'Model', modelName),
      ...(canEffort ? [picker('effort', 'Effort', effortName)] : []),
      ...(accounts.length > 1 || account !== 'main' ? [picker('account', 'Claude account', ACCOUNT_LABEL[account])] : []),
    ]],
    ['Goal', [
      action('goal', 'Goal', run ? runLine(run) : 'Off'),
      picker('build', 'Build', buildFlow ? 'Spec flow' : 'Off'),
    ]],
    ['Chat', [
      ...(sessionId ? [picker('fork', 'Fork', 'Side chat or a new chat from a summary'), picker('remind', 'Remind me', 'Add a task to check this chat later')] : []),
      picker('remember', 'Remember…', 'Save a preference to Memory'),
      picker('copy', 'Copy', resumeCommand ? 'As Markdown or the terminal command' : 'As Markdown'),
      picker('tools', 'Tools…', 'Saved prompts, memory, hooks, TODOs'),
    ]],
  ] as const;
  if (narrow) {
    return (
      <Sheet label="Chat settings" onClose={close}>
        <h2>Chat settings</h2>
        {groups.map(([label, rows]) => (
          <div key={label}>
            <Section label={label} />
            <SheetRows items={rows} onPick={onPick} />
          </div>
        ))}
      </Sheet>
    );
  }
  return (
    <QuickPick
      anchor={pick.at}
      title="Chat settings"
      items={groups.flatMap(([, rows]) => rows.map(({ value, label, detail }) => ({ value, label, detail })))}
      onPick={onPick}
      onClose={close}
    />
  );
}

export function ToolsPick({ pick, setPick, close, savedCount }: Props & { savedCount: number }) {
  const cwd = useStore((s) => s.session.cwd);
  const instructionFiles = useStore((s) => s.session.instructionFiles);
  const hooks = useStore((s) => s.session.hooks) ?? [];
  return (
    <ChoicePick
      back={() => setPick({ kind: 'menu', at: pick.at })}
      anchor={pick.at}
      title="Tools"
      items={[
        { value: 'saved', label: 'Saved prompts', detail: `${savedCount}` },
        { value: 'memory', label: 'Memory', detail: `${ruleFile(cwd, instructionFiles)} and memory files` },
        { value: 'hooks', label: 'Hooks', detail: hooks.length ? `${hooks.length}` : 'None' },
        { value: 'todos', label: 'TODOs', detail: 'TODO, FIXME and AI! comments in the repo' },
      ]}
      onPick={(v) => setPick({ kind: v as Pick['kind'], at: pick.at })}
      onClose={close}
    />
  );
}

type SubProps = { pick: Pick; close: () => void; back: () => void };

export function ForkPick({ pick, close, back }: SubProps) {
  return (
    <ChoicePick
      back={back}
      anchor={pick.at}
      title="Fork"
      items={[
        { value: 'side', label: 'Side chat', detail: 'Ask in a fork beside this chat (⌘;)' },
        { value: 'fork', label: 'New chat', detail: 'Start a new chat from a summary of this one' },
      ]}
      onPick={(v) => { (v === 'side' ? sideChat : forkChat)(); close(); }}
      onClose={close}
    />
  );
}

export function CopyPick({ pick, close, back }: SubProps) {
  const resumeCommand = useStore((s) => s.session.resumeCommand);
  return (
    <ChoicePick
      back={back}
      anchor={pick.at}
      title="Copy"
      items={[
        { value: 'markdown', label: 'Copy as Markdown', detail: 'Prompts and replies loaded here' },
        ...(resumeCommand ? [{ value: 'terminal', label: 'Continue in terminal', detail: 'Copy the command that resumes this chat' }] : []),
      ]}
      onPick={(v) => { if (v === 'terminal') copyResumeCommand(resumeCommand!); else copyChatMarkdown(); close(); }}
      onClose={close}
    />
  );
}

export function RemindPick({ pick, close, back }: SubProps) {
  return (
    <ChoicePick
      back={back}
      anchor={pick.at}
      title="Remind me"
      items={remindChoices(Date.now()).map((c) => ({ value: String(c.at), label: c.label }))}
      onPick={(v) => { remindChat(Number(v)).then(() => notice('Reminder set'), () => notice('Could not set the reminder. Try again.')); close(); }}
      onClose={close}
    />
  );
}

export function RememberPick({ close }: { close: () => void }) {
  return <Confirm title="Remember" detail="Saved to Memory for every later chat." action="Save" icon="lightbulb" input={{ value: '', placeholder: 'What to remember' }} run={async (text) => rememberChat(text)} onClose={close} />;
}

export function HooksPick({ pick, close, back }: SubProps) {
  const hooks = useStore((s) => s.session.hooks) ?? [];
  return (
    <ChoicePick
      back={back}
      anchor={pick.at}
      title="Hooks"
      items={hooks.length ? hooks.map((name) => ({ value: name, label: name })) : [{ value: '', label: 'No hooks for this repo' }]}
      onPick={(v) => { if (v) send({ type: 'run_hook', name: v }); close(); }}
      onClose={close}
    />
  );
}
