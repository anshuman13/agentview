import { useState, type ComponentProps } from 'react';
import { send, useStore } from '../app/store';
import { QuickPick } from '../ui/QuickPick';
import { Icon } from '../ui/Icon';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { Sheet } from '../ui/Sheet';
import { useNarrow } from '../app/shell/useNarrow';
import { ACCOUNT_LABEL, ACCOUNT_NOTE, EFFORT_LABEL } from '../../../shared/protocol';
import { modeSteps, newestModels } from '../../../shared/providers';
import { effortsFor } from './capabilitiesLogic';
import { useCan } from './useCan';
import { useChatSettings, type Pick } from './ChatSettings';

const LOOP_ITEMS = [
  { value: 'off', label: 'Off', detail: 'Prompts run as usual' },
  ...[1, 2, 3, 5].map((n) => ({ value: String(n), label: `Up to ${n} ${n === 1 ? 'round' : 'rounds'}`, detail: 'Opus plans and builds, Sonnet tests and reports, Opus fixes what fails' })),
];

const BUILD = { value: '\0build', label: 'Build', detail: 'Spec, review, build and test the brief in the composer' };
const OLDER = '\0older';

type Props = { pick: Pick; close: () => void; back: () => void };

export function SheetRows({ items, current, onPick }: { items: readonly (ComponentProps<typeof QuickPick>['items'][number] & { picker?: boolean })[]; current?: string | null; onPick: (value: string) => void }) {
  return (
    <div className="ui-group">
      {items.map((i) => <Row key={i.value} title={i.label} meta={i.detail} trailing={i.value === current ? <Icon name="check" small /> : i.picker && <Icon name="chevron-right" small />} onClick={() => onPick(i.value)} />)}
    </div>
  );
}

export function ChoicePick({ back, ...props }: ComponentProps<typeof QuickPick> & { back: () => void }) {
  const narrow = useNarrow();
  if (!narrow) return <QuickPick {...props} />;
  return (
    <Sheet label={props.title} onClose={back}>
      <Section label={props.title} />
      <SheetRows items={props.items} current={props.current} onPick={props.onPick} />
    </Sheet>
  );
}

export function ModelPick({ pick, close, back }: Props) {
  const { model, models } = useChatSettings();
  const build = useCan('build');
  const [all, setAll] = useState(false);
  const newest = newestModels(models, model);
  const more = all ? 0 : models.length - newest.length;
  return (
    <ChoicePick
      back={back}
      anchor={pick.at}
      title="Select model"
      current={model}
      items={[
        ...(more ? newest : models).map((m) => ({ value: m.value, label: m.displayName, detail: m.description })),
        ...(more ? [{ value: OLDER, label: 'Older models', detail: `${more} more` }] : []),
        ...(build ? [BUILD] : []),
      ]}
      onPick={(v) => {
        if (v === OLDER) return setAll(true);
        if (v === BUILD.value) window.dispatchEvent(new CustomEvent('agentview:build'));
        else send({ type: 'set_model', model: v });
        close();
      }}
      onClose={close}
    />
  );
}

export function EffortPick({ pick, close, back }: Props) {
  const { effort, model, models } = useChatSettings();
  return (
    <ChoicePick
      back={back}
      anchor={pick.at}
      title="Select effort"
      current={effort}
      items={effortsFor(models, model).map((e) => ({ value: e, label: EFFORT_LABEL[e] }))}
      onPick={(v) => { send({ type: 'set_effort', effort: v }); close(); }}
      onClose={close}
    />
  );
}

export function AccountPick({ pick, close, back }: Props) {
  const account = useStore((s) => s.session.account) ?? 'main';
  const accounts = useStore((s) => s.session.accounts) ?? [];
  return (
    <ChoicePick
      back={back}
      anchor={pick.at}
      title="Select Claude account"
      current={account}
      items={accounts.map((a) => ({ value: a, label: ACCOUNT_LABEL[a], detail: ACCOUNT_NOTE[a] }))}
      onPick={(v) => { send({ type: 'set_account', account: v }); close(); }}
      onClose={close}
    />
  );
}

export function LoopPick({ pick, close, back }: Props) {
  const { loop } = useChatSettings();
  return (
    <ChoicePick
      back={back}
      anchor={pick.at}
      title="Build cycle"
      current={loop.on ? String(loop.max) : 'off'}
      items={LOOP_ITEMS}
      onPick={(v) => { send(v === 'off' ? { type: 'set_loop', on: false } : { type: 'set_loop', on: true, max: Number(v) }); close(); }}
      onClose={close}
    />
  );
}

export function ModePick({ pick, close, back }: Props) {
  const { mode, review, menu } = useChatSettings();
  return (
    <ChoicePick
      back={back}
      anchor={pick.at}
      title="Permission mode"
      current={menu.checked}
      items={menu.list}
      onPick={(v) => {
        const step = modeSteps(mode, review, v);
        if (step.mode) send({ type: 'set_permission_mode', mode: step.mode });
        if (step.review !== null) send({ type: 'set_review', on: step.review });
        close();
      }}
      onClose={close}
    />
  );
}
