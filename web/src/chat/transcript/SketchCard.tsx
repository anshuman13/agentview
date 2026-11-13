import { sendToChat, setUi } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { MenuItem } from '../../ui/Menu';
import { Row } from '../../ui/Row';
import { command } from '../../ui/util';
import { useBuild } from '../../sessions/useBuilds';
import { useCan } from '../useCan';
import { canBuild } from '../../../../shared/builds';
import { buildSpecPrompt } from '../../../../shared/specTasks';
import { sketchName, sketchTitle } from '../../../../shared/sketches';
import { BuildSheets, useBuildSheets } from './BuildSheets';

// A mockup the agent wrote; a tap opens it on the Sketches page, the menu offers its spec when one has the same slug.
export function SketchCard({ path, meta }: { path: string; meta: string }) {
  const name = sketchName(path);
  const { data, reload } = useBuild(sketchTitle(name), true);
  const spec = data?.specFile ? data : null;
  const can = useCan('subagents');
  const sheets = useBuildSheets();
  return (
    <>
    <div className="ui-group tr-act">
      <Row
        leading={<Icon name="paintcan" />} title={sketchTitle(name)} meta={meta} onClick={() => { setUi({ sketch: name }); command('page:sketches'); }}
        menu={spec && (
          <>
            {canBuild(spec) && <MenuItem disabled={!can} title={can ? undefined : 'Needs subagents, not in this chat'} onClick={() => sendToChat(buildSpecPrompt(spec.specFile!))}>Build</MenuItem>}
            <MenuItem onClick={() => sheets.open({ kind: 'spec' })}>Open spec</MenuItem>
          </>
        )}
      />
    </div>
    {spec && <BuildSheets d={spec} sheets={sheets} reload={reload} />}
    </>
  );
}
