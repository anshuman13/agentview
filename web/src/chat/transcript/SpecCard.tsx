import { send, setUi, useStore } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { command } from '../../ui/util';
import { usePlanProgress } from '../../sessions/usePlanProgress';
import { useCan } from '../useCan';
import { Findings } from '../../ops/Findings';
import { SPEC_REVIEW_COMMAND } from '../../../../shared/specTasks';
import { TranscriptBox } from './Box';

const openBuild = (slug: string) => { setUi({ buildSlug: slug }); command('page:builds'); };

// A spec the agent wrote; the box opens to its task count, which links to the build page.
export function SpecCard({ id, slug, path, meta }: { id: string; slug: string; path: string; meta: string }) {
  return (
    <TranscriptBox id={`spec:${id}`} title={slug} meta={meta}>
      <div className="ui-group tr-act"><SpecTasks slug={slug} path={path} /><SpecReview path={path} /></div>
      <Findings target={`spec:${slug}`} />
    </TranscriptBox>
  );
}

// Mounted only while the box is open, so the file is read only then.
function SpecTasks({ slug, path }: { slug: string; path: string }) {
  const chat = useStore((s) => s.session.id);
  const { progress } = usePlanProgress(path, chat);
  return <Row title="Tasks" meta={progress ?? 'No tasks'} onClick={() => openBuild(slug)} />;
}

function SpecReview({ path }: { path: string }) {
  const can = useCan('subagents');
  return <Row title="Review with fresh eyes" meta={can ? 'Two reviewers read only this spec' : 'Needs subagents, not in this chat'} disabled={!can} onClick={() => send({ type: 'prompt', text: `/${SPEC_REVIEW_COMMAND} ${path}` })} />;
}

// A build agent's spec, shown plain inside the agent box.
export function SpecRow({ slug, meta }: { slug: string; meta: string }) {
  return (
    <div className="ui-group tr-act">
      <Row leading={<Icon name="beaker" />} title={slug} meta={meta} onClick={() => openBuild(slug)} />
    </div>
  );
}
