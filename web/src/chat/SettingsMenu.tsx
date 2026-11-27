import { useStore } from '../app/store';
import { runHook } from './chatActions';
import { chatImages } from './composer/composerLogic';
import { QuickPick } from '../ui/QuickPick';
import { Section } from '../ui/Section';
import { Sheet } from '../ui/Sheet';
import { useNarrow } from '../app/shell/useNarrow';
import { keyText } from '../app/shell/keys';
import { ACCOUNT_LABEL } from '../../../shared/protocol';
import { plural } from '../ui/util';
import { copyResumeCommand, sideChat } from './chatActions';
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
  const act = (fn: () => void) => { fn(); close(); };
  const onPick = (v: string) => {
    if (v === 'find') return act(() => window.dispatchEvent(new Event('agentview:find')));
    if (v === 'side') return act(sideChat);
    if (v === 'terminal') return act(() => copyResumeCommand(resumeCommand!));
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
      ...(sessionId ? [action('side', 'Side chat', `Ask in a fork beside this chat (${keyText('⌘;')})`)] : []),
      ...(resumeCommand ? [action('terminal', 'Continue in terminal', 'Copy the command that resumes this chat')] : []),
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

export function HooksPick({ pick, close, back }: SubProps) {
  const hooks = useStore((s) => s.session.hooks) ?? [];
  return (
    <ChoicePick
      back={back}
      anchor={pick.at}
      title="Hooks"
      items={hooks.length ? hooks.map((name) => ({ value: name, label: name })) : [{ value: '', label: 'No hooks for this repo' }]}
      onPick={(v) => { if (v) runHook(v); close(); }}
      onClose={close}
    />
  );
}
