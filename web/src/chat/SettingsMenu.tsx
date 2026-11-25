import { notice, send, useStore } from '../app/store';
import { chatImages, lastReply, remindChoices, sentPrompts } from './composer/composerLogic';
import { time } from '../sessions/brief/time';
import { QuickPick } from '../ui/QuickPick';
import { Section } from '../ui/Section';
import { Sheet } from '../ui/Sheet';
import { useNarrow } from '../app/shell/useNarrow';
import { keyText } from '../app/shell/keys';
import { ACCOUNT_LABEL } from '../../../shared/protocol';
import { firstLine, plural } from '../ui/util';
import { copyChatMarkdown, copyLastReply, copyResumeCommand, forkChat, remindChat, sideChat } from './chatActions';
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
  const prompts = sentPrompts(useStore((s) => s.events)).length;
  const act = (fn: () => void) => { fn(); close(); };
  const onPick = (v: string) => {
    if (v === 'find') return act(() => window.dispatchEvent(new Event('agentview:find')));
    setPick({ kind: v as Pick['kind'], at: pick.at });
  };
  const narrow = useNarrow();
  const picker = (value: string, label: string, detail: string, disabled = false) => ({ value, label, detail, picker: true, disabled });
  const action = (value: string, label: string, detail: string) => ({ value, label, detail, picker: false });
  const groups = [
    ['Run', [
      picker('mode', 'Permission mode', menu.label),
      picker('model', 'Model', modelName),
      ...(canEffort ? [picker('effort', 'Effort', effortName)] : []),
      ...(accounts.length > 1 || account !== 'main' ? [picker('account', 'Claude account', ACCOUNT_LABEL[account])] : []),
    ]],
    ['Chat', [
      action('find', 'Find in chat', 'Search the prompts and replies'),
      picker('prompts', 'Prompts', prompts ? plural(prompts, 'prompt') : 'No prompts', !prompts),
      ...(sessionId ? [picker('fork', 'Fork', 'Side chat or a new chat from a summary'), picker('remind', 'Remind me', 'Add a task to check this chat later')] : []),
      picker('remember', 'Remember…', 'Save a preference to Memory'),
      picker('copy', 'Copy', resumeCommand ? 'As Markdown or the terminal command' : 'As Markdown'),
      picker('tools', 'Tools…', 'Saved prompts, images, TODOs, memory, hooks'),
    ]],
  ] as const;
  if (narrow) {
    return (
      <Sheet label="Chat settings" onClose={close}>
        <Section label="Chat settings" />
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
      items={groups.flatMap(([, rows]) => rows)}
      onPick={onPick}
      onClose={close}
    />
  );
}

export function ToolsPick({ pick, setPick, close, savedCount }: Props & { savedCount: number }) {
  const hooks = useStore((s) => s.session.hooks) ?? [];
  const images = chatImages(useStore((s) => s.events)).length;
  return (
    <ChoicePick
      back={() => setPick({ kind: 'menu', at: pick.at })}
      anchor={pick.at}
      title="Tools"
      items={[
        { value: 'saved', label: 'Saved prompts', detail: plural(savedCount, 'prompt'), disabled: !savedCount },
        { value: 'images', label: 'Images', detail: plural(images, 'image'), disabled: !images },
        { value: 'todos', label: 'TODOs', detail: 'TODO, FIXME and AI! comments in the repo' },
        { value: 'memory', label: 'Memory', detail: 'Instruction and memory files' },
        { value: 'hooks', label: 'Hooks', detail: hooks.length ? `${hooks.length}` : 'None' },
      ]}
      onPick={(v) => setPick({ kind: v as Pick['kind'], at: pick.at })}
      onClose={close}
    />
  );
}

type SubProps = { pick: Pick; close: () => void; back: () => void };

export function PromptsPick({ pick, close, back }: SubProps) {
  const prompts = sentPrompts(useStore((s) => s.events));
  return (
    <ChoicePick
      back={back}
      anchor={pick.at}
      title="Prompts"
      items={prompts.map((e) => ({ value: e.id, label: firstLine(e.text).slice(0, 200), detail: `Sent ${time(e.at)}` }))}
      onPick={(id) => { close(); window.dispatchEvent(new CustomEvent('agentview:show-prompt', { detail: { id } })); }}
      onClose={close}
    />
  );
}

export function ForkPick({ pick, close, back }: SubProps) {
  return (
    <ChoicePick
      back={back}
      anchor={pick.at}
      title="Fork"
      items={[
        { value: 'side', label: 'Side chat', detail: `Ask in a fork beside this chat (${keyText('⌘;')})` },
        { value: 'fork', label: 'New chat', detail: 'Start a new chat from a summary of this one' },
      ]}
      onPick={(v) => { (v === 'side' ? sideChat : forkChat)(); close(); }}
      onClose={close}
    />
  );
}

export function CopyPick({ pick, close, back }: SubProps) {
  const resumeCommand = useStore((s) => s.session.resumeCommand);
  const hasReply = useStore((s) => lastReply(s.events) !== null);
  return (
    <ChoicePick
      back={back}
      anchor={pick.at}
      title="Copy"
      items={[
        ...(hasReply ? [{ value: 'reply', label: 'Last reply', detail: 'The latest answer as Markdown' }] : []),
        { value: 'markdown', label: 'Copy as Markdown', detail: 'Prompts and replies loaded here' },
        ...(resumeCommand ? [{ value: 'terminal', label: 'Continue in terminal', detail: 'Copy the command that resumes this chat' }] : []),
      ]}
      onPick={(v) => { if (v === 'terminal') copyResumeCommand(resumeCommand!); else if (v === 'reply') copyLastReply(); else copyChatMarkdown(); close(); }}
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
