import { setUi, useStore } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { command } from '../../ui/util';
import { usePlanProgress } from '../../sessions/usePlanProgress';
import { TranscriptBox } from './Box';

const openBuild = (slug: string) => { setUi({ buildSlug: slug }); command('page:builds'); };

// A spec the agent wrote; the box opens to its task count, which links to the build page.
export function SpecCard({ id, slug, path, meta }: { id: string; slug: string; path: string; meta: string }) {
  return (
    <TranscriptBox id={`spec:${id}`} title={slug} meta={meta}>
      <div className="ui-group tr-act"><SpecTasks slug={slug} path={path} /></div>
    </TranscriptBox>
  );
}

// Mounted only while the box is open, so the file is read only then.
function SpecTasks({ slug, path }: { slug: string; path: string }) {
  const chat = useStore((s) => s.session.id);
  const { progress } = usePlanProgress(path, chat);
  return <Row title="Tasks" meta={progress ?? 'No tasks'} onClick={() => openBuild(slug)} />;
}

// A build agent's spec, shown plain inside the agent box.
export function SpecRow({ slug, meta }: { slug: string; meta: string }) {
  return (
    <div className="ui-group tr-act">
      <Row leading={<Icon name="beaker" />} title={slug} meta={meta} onClick={() => openBuild(slug)} />
    </div>
  );
}
