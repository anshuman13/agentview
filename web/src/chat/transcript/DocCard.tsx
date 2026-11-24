import { setUi } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { relPath, type Item } from './steps';
import { CopyPathItems } from '../../workspace/CopyPathItems';
import { LinkAction, TranscriptBox } from './Box';

const docTitle = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.(md|markdown|mdx)$/i, '').replace(/[-_]+/g, ' ');

// A Markdown file the agent wrote, shown like an artifact: a tap opens it rendered beside the chat.
export function DocCard({ it, cwd }: { it: Extract<Item, { kind: 'file' }>; cwd: string }) {
  const rel = relPath(it.path, cwd);
  const meta = it.pending ? 'Updating…' : `${it.uses[0].name === 'Write' && it.uses.length === 1 ? 'Written' : `Edited · +${it.count.add} -${it.count.del}`} · ${rel}`;
  const open = () => setUi({ openFile: rel, follow: false });
  return <TranscriptBox id={`doc:${it.id}`} icon={<Icon name={it.pending ? 'loading' : 'markdown'} spin={it.pending} />} title={docTitle(rel)} meta={meta} action={<LinkAction label="Open" onClick={open} />} onOpen={open} menu={<CopyPathItems path={it.path} cwd={cwd} />} />;
}
