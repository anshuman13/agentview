import { useEffect, useState } from 'react';
import { sendToChat, setUi } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { MenuItem } from '../../ui/Menu';
import { command } from '../../ui/util';
import { useBuild } from '../../sessions/useBuilds';
import { useCan } from '../useCan';
import { canBuild } from '../../../../shared/builds';
import { buildSpecPrompt } from '../../../../shared/specTasks';
import { sketchName, sketchTitle } from '../../../../shared/sketches';
import { BuildSheets, useBuildSheets } from './BuildSheets';
import { LinkAction, TranscriptBox } from './Box';

function OnOpen({ run }: { run: () => void }) {
  useEffect(run, []);
  return null;
}

// A mockup the agent wrote; a tap opens it on the Sketches page, the menu offers its spec when one has the same slug.
export function SketchCard({ path, meta }: { path: string; meta: string }) {
  const name = sketchName(path);
  const [asked, setAsked] = useState(false);
  const { data, gone, reload } = useBuild(sketchTitle(name), asked);
  const spec = data?.specFile ? data : null;
  const can = useCan('subagents');
  const sheets = useBuildSheets();
  const open = () => { setUi({ sketch: name }); command('page:sketches'); };
  return (
    <>
      <TranscriptBox
        id={`sketch:${name}`} icon={<Icon name="paintcan" />} title={sketchTitle(name)} meta={meta} onOpen={open} action={<LinkAction label="Open" onClick={open} />}
        menu={(
          <>
            <OnOpen run={() => setAsked(true)} />
            {spec && can && canBuild(spec) && <MenuItem onClick={() => sendToChat(buildSpecPrompt(spec.specFile!))}>Build</MenuItem>}
            {spec ? <MenuItem onClick={() => sheets.open({ kind: 'spec' })}>Open spec</MenuItem> : <MenuItem disabled icon={gone ? undefined : 'loading'} spin={!gone}>{gone ? 'No spec for this sketch' : 'Loading'}</MenuItem>}
          </>
        )}
      />
    {spec && <BuildSheets d={spec} sheets={sheets} reload={reload} />}
    </>
  );
}
