import { notice, send, setUi, useStore } from '../app/store';
import { remindChoices, runLine } from './composer/composerLogic';
import { useChatRun } from '../sessions/runBands';
import { openGoal } from '../sessions/goalLogic';
import { QuickPick } from '../ui/QuickPick';
import { Icon } from '../ui/Icon';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { Sheet } from '../ui/Sheet';
import { useNarrow } from '../app/shell/useNarrow';
import { ACCOUNT_LABEL } from '../../../shared/protocol';
import { copyChatMarkdown, copyResumeCommand, forkChat, remindChat, sideChat } from './chatActions';
import { ruleFile } from './cards/Memory';
import { useChatSettings, type Pick } from './ChatSettings';
import { useCan } from './useCan';
import { ChoicePick } from './SettingsPickers';

type Props = { pick: Pick; setPick: (p: Pick | null) => void; close: () => void };

export function SettingsMenu({ pick, setPick, close }: Props) {
  const { loop, menu, modelName, effortName } = useChatSettings();
  const canEffort = useCan('effort');
  const sessionId = useStore((s) => s.session.sessionId);
  const account = useStore((s) => s.session.account) ?? 'main';
  const accounts = useStore((s) => s.session.accounts) ?? [];
  const chat = useStore((s) => s.session.id);
  const phase = useStore((s) => s.session.loop.phase);
  const run = useChatRun(chat);
  const act = (fn: () => void) => { fn(); close(); };
  const onPick = (v: string) => {
    if (v === 'side') return act(sideChat);
    if (v === 'fork') return act(forkChat);
    if (v === 'markdown') return act(copyChatMarkdown);
    if (v === 'goal') return act(() => (run ? openGoal(run.id) : setUi({ goalSheet: { mode: 'start', here: true } })));
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
      action('goal', 'Goal', run ? runLine(run, phase) : 'Off'),
      picker('loop', 'Build cycle', loop.on ? `Up to ${loop.max} ${loop.max === 1 ? 'round' : 'rounds'}` : 'Off'),
    ]],
    ['Chat', [
      ...(sessionId ? [action('side', 'Side chat', 'Ask in a fork beside this chat (⌘;)'), picker('remind', 'Remind me', 'Add a task to check this chat later'), action('fork', 'Fork chat', 'Start a new chat from a summary of this one')] : []),
      action('markdown', 'Copy as Markdown', 'Prompts and replies loaded here'),
      picker('tools', 'Tools…', 'Saved prompts, memory, hooks, TODOs'),
    ]],
  ] as const;
  if (narrow) {
    return (
      <Sheet label="Chat settings" onClose={close}>
        <Section label="Chat settings" />
        {groups.map(([label, rows]) => (
          <div key={label}>
            <Section label={label} />
            <div className="ui-group">
              {rows.map((r) => <Row key={r.value} title={r.label} meta={r.detail} trailing={r.picker && <Icon name="chevron-right" small />} onClick={() => onPick(r.value)} />)}
            </div>
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
  const cwd = useStore((s) => s.session.cwd);
  const instructionFiles = useStore((s) => s.session.instructionFiles);
  const resumeCommand = useStore((s) => s.session.resumeCommand);
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
        ...(resumeCommand ? [{ value: 'terminal', label: 'Continue in terminal', detail: 'Copy the command that resumes this chat' }] : []),
      ]}
      onPick={(v) => {
        if (v === 'terminal') { copyResumeCommand(resumeCommand!); close(); } else setPick({ kind: v as Pick['kind'], at: pick.at });
      }}
      onClose={close}
    />
  );
}

export function RemindPick({ pick, close, back }: { pick: Pick; close: () => void; back: () => void }) {
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

export function HooksPick({ pick, close, back }: { pick: Pick; close: () => void; back: () => void }) {
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
