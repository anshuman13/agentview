import { Chip } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { markChip } from './composerLogic';

export function AttachmentsBar({ marks, remove }: { marks: string[]; remove: (i: number) => void }) {
  if (marks.length === 0) return null;
  return (
    <div className="cp-uses">
      {marks.map((m, i) => {
        const { kind, name } = markChip(m);
        return (
          <Chip key={`${i}${m}`} size="sm" icon={kind === 'Image' ? 'file-media' : 'file'} title={m.slice(m.indexOf(' ') + 1, -1)} aria-label={`Remove ${kind.toLowerCase()} ${name}`} onClick={() => remove(i)}>
            {name}<Icon name="close" small />
          </Chip>
        );
      })}
    </div>
  );
}
