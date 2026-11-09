import { Icon } from '../../ui/Icon';
import { toolId } from '../../ops/mcpHelpers';
import { useLabel, type Use } from './composerLogic';

export function UsesBar({ uses, remove }: { uses: Use[]; remove: (u: Use) => void }) {
  if (uses.length === 0) return null;
  return (
    <div className="cp-uses">
      {uses.map((u) => (
        <span key={useLabel(u)} className="cp-use" title={u.tool ? `Claude is asked to use ${toolId(u.server, u.tool)}` : `Claude is asked to use the ${u.server} MCP server`}>
          <Icon name="plug" small /><span>{u.server}</span>{u.tool && <span className="mono">{u.tool}</span>}
          <button className="icon-btn" aria-label={`Remove ${u.tool ?? u.server}`} onClick={() => remove(u)}><Icon name="close" small /></button>
        </span>
      ))}
    </div>
  );
}
