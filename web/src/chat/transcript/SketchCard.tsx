import { setUi } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { command } from '../../ui/util';
import { sketchName, sketchTitle } from '../../../../shared/sketches';

// A mockup the agent wrote; a tap opens it on the Sketches page.
export function SketchCard({ path, meta }: { path: string; meta: string }) {
  const name = sketchName(path);
  return (
    <div className="ui-group tr-act">
      <Row leading={<Icon name="paintcan" />} title={sketchTitle(name)} meta={meta} onClick={() => { setUi({ sketch: name }); command('page:sketches'); }} />
    </div>
  );
}
