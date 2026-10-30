import { send, useStore } from '../app/store';
import { QuickPick } from '../ui/QuickPick';
import { ACCOUNT_LABEL, EFFORT_LABEL, EFFORT_LEVELS, PERMISSION_MODES } from '../../../shared/protocol';

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

export type Pick = { kind: 'menu' | 'model' | 'effort' | 'account' | 'mode' | 'loop' | 'saved' | 'mcp' | 'mcpTools'; at: DOMRect; server?: string };

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
export function ChatSettings({ pick, setPick, savedCount }: { pick: Pick | null; setPick: (p: Pick | null) => void; savedCount: number }) {
  const { mode, model, models, effort, team, loop, modelName, effortName, modeInfo } = useChatSettings();
  const sessionId = useStore((s) => s.session.sessionId);
  const account = useStore((s) => s.session.account) ?? 'main';
  const accounts = useStore((s) => s.session.accounts) ?? [];
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
            { value: 'loop', label: 'Plan, build, test loop', detail: loop.on ? `Up to ${loop.max} ${loop.max === 1 ? 'round' : 'rounds'}` : 'Off' },
            { value: 'saved', label: 'Saved prompts', detail: `${savedCount}` },
            ...(sessionId ? [{ value: 'fork', label: 'Fork chat', detail: 'Continue this conversation in a new chat' }] : []),
          ]}
          onPick={(v) => {
            if (v === 'fork') { send({ type: 'new_session', fork: sessionId! }); close(); return; }
            setPick({ kind: v as 'mode' | 'model' | 'effort' | 'account' | 'loop' | 'saved', at: pick.at });
          }}
          onClose={close}
        />
      )}
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
          items={accounts.map((a) => ({ value: a, label: ACCOUNT_LABEL[a] }))}
          onPick={(v) => { send({ type: 'set_account', account: v }); close(); }}
          onClose={close}
        />
      )}
      {pick.kind === 'loop' && (
        <QuickPick
          anchor={pick.at}
          title="Plan, build, test loop"
          current={loop.on ? String(loop.max) : 'off'}
          items={LOOP_ITEMS}
          onPick={(v) => { send(v === 'off' ? { type: 'set_loop', on: false } : { type: 'set_loop', on: true, max: Number(v) }); close(); }}
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
