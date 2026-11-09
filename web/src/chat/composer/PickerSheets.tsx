import { useStore } from '../../app/store';
import { QuickPick } from '../../ui/QuickPick';
import { plural } from '../../ui/util';
import type { Pick } from '../ChatSettings';
import { addUse, type Use } from './composerLogic';

type Props = { pick: Pick | null; setPick: (p: Pick | null) => void; sentHistory: string[]; setUses: (f: (u: Use[]) => Use[]) => void; apply: (text: string) => void; focus: () => void };

export function PickerSheets({ pick, setPick, sentHistory, setUses, apply, focus }: Props) {
  const servers = useStore((s) => s.session.mcp).filter((m) => m.status === 'connected');
  if (pick?.kind === 'saved') {
    return (
      <QuickPick
        anchor={pick.at}
        title="Saved prompts"
        items={[...sentHistory].reverse().map((t, i) => ({ value: String(i), label: t.replace(/\s+/g, ' ').slice(0, 200) }))}
        onPick={(v) => { apply([...sentHistory].reverse()[Number(v)]); setPick(null); focus(); }}
        onClose={() => setPick(null)}
      />
    );
  }
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
        items={[{ value: '', label: 'Any tool', detail: 'Claude picks' }, ...(servers.find((m) => m.name === pick.server)?.tools ?? []).map((t) => ({ value: t.name, label: t.name, detail: t.description }))]}
        onPick={(v) => { setUses((u) => addUse(u, v ? { server: pick.server!, tool: v } : { server: pick.server! })); setPick(null); focus(); }}
        onClose={() => setPick(null)}
      />
    );
  }
  return null;
}
