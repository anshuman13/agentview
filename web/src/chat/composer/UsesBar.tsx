import { Chip } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { toolId } from '../../ops/mcpHelpers';
import { useLabel, type Use } from './composerLogic';

export function UsesBar({ uses, remove }: { uses: Use[]; remove: (u: Use) => void }) {
  if (uses.length === 0) return null;
  return (
    <div className="cp-uses">
      {uses.map((u) => (
        <Chip key={useLabel(u)} className="cp-use" icon="plug" size="sm" title={u.tool ? `Claude is asked to use ${toolId(u.server, u.tool)}` : `Claude is asked to use the ${u.server} MCP server`} aria-label={`Remove ${u.tool ?? u.server}`} onClick={() => remove(u)}>
          <span>{u.server}</span>{u.tool && <span className="mono">{u.tool}</span>}<Icon name="close" small />
        </Chip>
      ))}
    </div>
  );
}
