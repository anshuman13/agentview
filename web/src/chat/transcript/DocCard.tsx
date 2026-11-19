import { setUi } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { relPath, type Item } from './steps';

const docTitle = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.(md|markdown|mdx)$/i, '').replace(/[-_]+/g, ' ');

// A Markdown file the agent wrote, shown like an artifact: a tap opens it rendered beside the chat.
export function DocCard({ it, cwd }: { it: Extract<Item, { kind: 'file' }>; cwd: string }) {
  const rel = relPath(it.path, cwd);
  const meta = it.pending ? 'Updating…' : `${it.uses[0].name === 'Write' && it.uses.length === 1 ? 'Written' : `Edited · +${it.count.add} -${it.count.del}`} · ${rel}`;
  return (
    <div className="ui-group tr-act">
      <Row leading={<Icon name={it.pending ? 'loading' : 'markdown'} spin={it.pending} />} title={docTitle(rel)} meta={meta} lines={1} onClick={() => setUi({ openFile: rel, follow: false })} />
    </div>
  );
}
