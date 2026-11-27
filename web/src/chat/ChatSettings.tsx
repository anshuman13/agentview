import { useStore } from '../app/store';
import { MemoryPick } from './cards/Memory';
import { TodosPick } from './cards/Todos';
import { ImagesPick } from './cards/Images';
import { EFFORT_LABEL } from '../../../shared/protocol';
import { menuModes, modelRow, providerModes } from '../../../shared/providers';
import { CopyPick, ForkPick, HooksPick, PromptsPick, RemindPick, SettingsMenu, ToolsPick } from './SettingsMenu';
import { AccountPick, EffortPick, ModePick, ModelPick } from './SettingsPickers';

const MODE_ICON: Record<string, string> = { default: 'shield', acceptEdits: 'edit', plan: 'eye', readOnly: 'eye', auto: 'zap', dontAsk: 'circle-slash' };

export type Pick = { kind: 'menu' | 'model' | 'effort' | 'account' | 'mode' | 'fork' | 'copy' | 'prompts' | 'tools' | 'saved' | 'mcp' | 'mcpTools' | 'memory' | 'remind' | 'todos' | 'hooks' | 'images'; at: DOMRect; server?: string };

export function useChatSettings() {
  const mode = useStore((s) => s.session.permissionMode) ?? 'default';
  const model = useStore((s) => s.session.model);
  const provider = useStore((s) => s.session.provider);
  const models = useStore((s) => s.session.models);
  const effort = useStore((s) => s.session.effort);
  const review = useStore((s) => s.session.review) ?? false;
  const row = modelRow(models, model ?? 'default');
  const modelName = models.find((m) => m.value === row)?.displayName ?? model ?? 'Default';
  const effortName = effort ? EFFORT_LABEL[effort] : 'Default';
  const modes = providerModes(provider);
  const menu = menuModes(provider, mode, review);
  const modeInfo = { ...(modes.find((m) => m.value === mode) ?? { label: mode, detail: mode }), icon: MODE_ICON[mode] ?? 'shield' };
  return { mode, modes, model, models, effort, review, modelName, effortName, modeInfo, menu };
}

// The chat settings menu and the pickers it opens; the saved prompt and MCP pickers stay with the composer.
export function ChatSettings({ pick, setPick, savedCount }: { pick: Pick | null; setPick: (p: Pick | null) => void; savedCount: number }) {
  const cwd = useStore((s) => s.session.cwd);
  if (!pick) return null;
  const close = () => setPick(null);
  const back = () => setPick({ kind: pick.kind === 'hooks' ? 'tools' : 'menu', at: pick.at });
  switch (pick.kind) {
    case 'menu': return <SettingsMenu pick={pick} setPick={setPick} close={close} />;
    case 'remind': return <RemindPick pick={pick} close={close} back={back} />;
    case 'hooks': return <HooksPick pick={pick} close={close} back={back} />;
    case 'todos': return <TodosPick anchor={pick.at} onClose={close} />;
    case 'memory': return <MemoryPick cwd={cwd} onClose={close} />;
    case 'images': return <ImagesPick cwd={cwd} onClose={close} />;
    case 'model': return <ModelPick pick={pick} close={close} back={back} />;
    case 'effort': return <EffortPick pick={pick} close={close} back={back} />;
    case 'account': return <AccountPick pick={pick} close={close} back={back} />;
    case 'fork': return <ForkPick pick={pick} close={close} back={back} />;
    case 'copy': return <CopyPick pick={pick} close={close} back={back} />;
    case 'prompts': return <PromptsPick pick={pick} close={close} back={back} />;
    case 'tools': return <ToolsPick pick={pick} setPick={setPick} close={close} savedCount={savedCount} />;
    case 'mode': return <ModePick pick={pick} close={close} back={back} />;
    default: return null;
  }
}
