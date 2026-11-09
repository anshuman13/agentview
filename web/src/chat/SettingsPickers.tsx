import { send, useStore } from '../app/store';
import { goalChoices, type GoalChoice } from './composer/composerLogic';
import { useChatRun } from '../sessions/runBands';
import { QuickPick } from '../ui/QuickPick';
import { ACCOUNT_LABEL, ACCOUNT_NOTE, EFFORT_LABEL, EFFORT_LEVELS, PERMISSION_MODES } from '../../../shared/protocol';
import { MODES, useChatSettings, type Pick } from './ChatSettings';

const LOOP_ITEMS = [
  { value: 'off', label: 'Off', detail: 'Prompts run as usual' },
  ...[1, 2, 3, 5].map((n) => ({ value: String(n), label: `Up to ${n} ${n === 1 ? 'round' : 'rounds'}`, detail: 'Opus plans and builds, Sonnet tests and reports, Opus fixes what fails' })),
];

type Props = { pick: Pick; close: () => void };

export function ModelPick({ pick, close }: Props) {
  const { model, models, team } = useChatSettings();
  return (
    <QuickPick
      anchor={pick.at}
      title="Select model"
      current={team ? 'team' : model}
      items={models.map((m) => ({ value: m.value, label: m.displayName, detail: m.description }))}
      onPick={(v) => { send({ type: 'set_model', model: v }); close(); }}
      onClose={close}
    />
  );
}

export function EffortPick({ pick, close }: Props) {
  const { effort } = useChatSettings();
  return (
    <QuickPick
      anchor={pick.at}
      title="Select effort"
      current={effort}
      items={EFFORT_LEVELS.map((e) => ({ value: e, label: EFFORT_LABEL[e] }))}
      onPick={(v) => { send({ type: 'set_effort', effort: v }); close(); }}
      onClose={close}
    />
  );
}

export function AccountPick({ pick, close }: Props) {
  const account = useStore((s) => s.session.account) ?? 'main';
  const accounts = useStore((s) => s.session.accounts) ?? [];
  return (
    <QuickPick
      anchor={pick.at}
      title="Select Claude account"
      current={account}
      items={accounts.map((a) => ({ value: a, label: ACCOUNT_LABEL[a], detail: ACCOUNT_NOTE[a] }))}
      onPick={(v) => { send({ type: 'set_account', account: v }); close(); }}
      onClose={close}
    />
  );
}

export function LoopPick({ pick, close }: Props) {
  const { loop } = useChatSettings();
  return (
    <QuickPick
      anchor={pick.at}
      title="Build cycle"
      current={loop.on ? String(loop.max) : 'off'}
      items={LOOP_ITEMS}
      onPick={(v) => { send(v === 'off' ? { type: 'set_loop', on: false } : { type: 'set_loop', on: true, max: Number(v) }); close(); }}
      onClose={close}
    />
  );
}

export function GoalPick({ pick, close, goal, setGoal }: Props & { goal: GoalChoice; setGoal: (g: GoalChoice) => void }) {
  const run = useChatRun(useStore((s) => s.session.id));
  return (
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
  );
}

export function ModePick({ pick, close }: Props) {
  const { mode } = useChatSettings();
  return (
    <QuickPick
      anchor={pick.at}
      title="Permission mode"
      current={mode}
      items={PERMISSION_MODES.map((m) => ({ value: m, label: MODES[m]?.label ?? m, detail: MODES[m]?.detail }))}
      onPick={(v) => { send({ type: 'set_permission_mode', mode: v }); close(); }}
      onClose={close}
    />
  );
}
