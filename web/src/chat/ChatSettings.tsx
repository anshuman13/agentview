import { useStore } from '../app/store';
import { type GoalChoice } from './composer/composerLogic';
import { MemoryPick } from './cards/Memory';
import { TodosPick } from './cards/Todos';
import { EFFORT_LABEL } from '../../../shared/protocol';
import { modelsFor } from './capabilitiesLogic';
import { HooksPick, RemindPick, SettingsMenu } from './SettingsMenu';
import { AccountPick, EffortPick, GoalPick, LoopPick, ModePick, ModelPick } from './SettingsPickers';

export const MODES: Record<string, { label: string; detail: string; icon: string }> = {
  default: { label: 'Default', detail: 'Ask before edits and risky commands', icon: 'shield' },
  acceptEdits: { label: 'Accept edits', detail: 'Edit files without asking, ask for the rest', icon: 'edit' },
  plan: { label: 'Plan', detail: 'Read and plan, no edits', icon: 'eye' },
  auto: { label: 'Auto', detail: 'Claude runs what is safe and asks only for risky actions', icon: 'zap' },
  dontAsk: { label: "Don't ask", detail: 'Deny anything not pre-approved', icon: 'circle-slash' },
};

export type Pick = { kind: 'menu' | 'model' | 'effort' | 'account' | 'mode' | 'loop' | 'goal' | 'saved' | 'mcp' | 'mcpTools' | 'memory' | 'remind' | 'todos' | 'hooks'; at: DOMRect; server?: string };

export function useChatSettings() {
  const mode = useStore((s) => s.session.permissionMode) ?? 'default';
  const model = useStore((s) => s.session.model);
  const caps = useStore((s) => s.session.capabilities);
  const models = modelsFor(useStore((s) => s.session.models), caps);
  const effort = useStore((s) => s.session.effort);
  const team = useStore((s) => s.session.team);
  const loop = useStore((s) => s.session.loop);
  const review = useStore((s) => s.session.review) ?? false;
  const modelName = team ? 'Team' : models.find((m) => m.value === (model ?? 'default'))?.displayName ?? model ?? 'Default';
  const effortName = effort ? EFFORT_LABEL[effort] : 'Default';
  const modeInfo = MODES[mode] ?? { label: mode, detail: mode, icon: 'shield' };
  return { mode, model, models, effort, team, loop, review, modelName, effortName, modeInfo };
}

// The chat settings menu and the pickers it opens; the saved prompt and MCP pickers stay with the composer.
export function ChatSettings({ pick, setPick, savedCount, goal, setGoal }: { pick: Pick | null; setPick: (p: Pick | null) => void; savedCount: number; goal: GoalChoice; setGoal: (g: GoalChoice) => void }) {
  const cwd = useStore((s) => s.session.cwd);
  if (!pick) return null;
  const close = () => setPick(null);
  switch (pick.kind) {
    case 'menu': return <SettingsMenu pick={pick} setPick={setPick} close={close} savedCount={savedCount} goal={goal} />;
    case 'remind': return <RemindPick pick={pick} close={close} />;
    case 'hooks': return <HooksPick pick={pick} close={close} />;
    case 'todos': return <TodosPick anchor={pick.at} onClose={close} />;
    case 'memory': return <MemoryPick cwd={cwd} onClose={close} />;
    case 'model': return <ModelPick pick={pick} close={close} />;
    case 'effort': return <EffortPick pick={pick} close={close} />;
    case 'account': return <AccountPick pick={pick} close={close} />;
    case 'loop': return <LoopPick pick={pick} close={close} />;
    case 'goal': return <GoalPick pick={pick} close={close} goal={goal} setGoal={setGoal} />;
    case 'mode': return <ModePick pick={pick} close={close} />;
    default: return null;
  }
}
