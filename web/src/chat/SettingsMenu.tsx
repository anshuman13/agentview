import { useStore } from '../app/store';
import { QuickPick } from '../ui/QuickPick';
import { Section } from '../ui/Section';
import { Sheet } from '../ui/Sheet';
import { useNarrow } from '../app/shell/useNarrow';
import { keyText } from '../app/shell/keys';
import { ACCOUNT_LABEL } from '../../../shared/protocol';
import { copyResumeCommand, sideChat } from './chatActions';
import { useChatSettings, type Pick } from './ChatSettings';
import { useCan } from './useCan';
import { SheetRows } from './SettingsPickers';

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
      picker('memory', 'Memory', 'Instruction and memory files'),
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
