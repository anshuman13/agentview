import { setUi } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { command } from '../../ui/util';

// A spec the agent wrote or a build agent works on; tapping opens its build page.
export function SpecCard({ slug, meta }: { slug: string; meta: string }) {
  return (
    <div className="ui-group tr-act">
      <Row leading={<Icon name="beaker" />} title={slug} meta={meta} onClick={() => { setUi({ buildSlug: slug }); command('page:builds'); }} />
    </div>
  );
}
