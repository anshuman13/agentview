import { setUi } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { command } from '../../ui/util';
import { sketchName, sketchTitle } from '../../../../shared/sketches';
import { LinkAction, TranscriptBox } from './Box';

// A mockup the agent wrote; a tap opens it on the Sketches page.
export function SketchCard({ path, meta }: { path: string; meta: string }) {
  const name = sketchName(path);
  const open = () => { setUi({ sketch: name }); command('page:sketches'); };
  return <TranscriptBox id={`sketch:${name}`} icon={<Icon name="paintcan" />} title={sketchTitle(name)} meta={meta} onOpen={open} action={<LinkAction label="Open" onClick={open} />} />;
}
