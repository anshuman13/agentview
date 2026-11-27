import { useStore } from '../../app/store';
import { QuickPick } from '../../ui/QuickPick';
import { plural } from '../../ui/util';
import type { Pick } from '../ChatSettings';
import { addUse, type Use } from './composerLogic';

type Props = { pick: Pick | null; setPick: (p: Pick | null) => void; setUses: (f: (u: Use[]) => Use[]) => void; focus: () => void };

export function PickerSheets({ pick, setPick, setUses, focus }: Props) {
  const servers = useStore((s) => s.session.mcp).filter((m) => m.status === 'connected');
  if (pick?.kind === 'mcp') {
    return (
      <QuickPick
        anchor={pick.at}
        title="Use an MCP server"
        items={servers.map((m) => ({ value: m.name, label: m.name, detail: plural(m.tools?.length ?? 0, 'tool') }))}
        onPick={(v) => setPick({ kind: 'mcpTools', at: pick.at, server: v })}
        onClose={() => setPick(null)}
      />
    );
  }
  if (pick?.kind === 'mcpTools') {
    return (
      <QuickPick
        anchor={pick.at}
        title={`Tool from ${pick.server}`}
        items={[{ value: '', label: 'Any tool', detail: 'The agent picks' }, ...(servers.find((m) => m.name === pick.server)?.tools ?? []).map((t) => ({ value: t.name, label: t.name, detail: t.description }))]}
        onPick={(v) => { setUses((u) => addUse(u, v ? { server: pick.server!, tool: v } : { server: pick.server! })); setPick(null); focus(); }}
        onClose={() => setPick(null)}
      />
    );
  }
  return null;
}
