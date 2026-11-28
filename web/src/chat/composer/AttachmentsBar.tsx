import { Chip } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { markChip } from './composerLogic';
import { elementChip, type PickedElement } from '../../../../shared/elementPick';
import { commentChip, type LineComment } from '../../../../shared/lineComment';

type Props = { marks: string[]; remove: (i: number) => void; elements: PickedElement[]; drop: (i: number) => void; comments: LineComment[]; dropComment: (i: number) => void };

// A picked page element: hovering or focusing the chip shows the crop of the page, the selector and the text.
function ElementChip({ el, drop }: { el: PickedElement; drop: () => void }) {
  return (
    <span className="cp-el">
      <Chip size="sm" icon="inspect" aria-label={`Remove element ${elementChip(el)}`} onClick={drop}>
        <span className="cp-el-name">{elementChip(el)}</span><Icon name="close" small />
      </Chip>
      <span className="cp-el-card" role="tooltip">
        {el.shot && <img src={`data:image/jpeg;base64,${el.shot}`} alt="" />}
        <code>{el.selector}</code>
        {el.text && <span>{el.text.slice(0, 200)}</span>}
      </span>
    </span>
  );
}

export function AttachmentsBar({ marks, remove, elements, drop, comments, dropComment }: Props) {
  if (marks.length === 0 && elements.length === 0 && comments.length === 0) return null;
  return (
    <div className="cp-uses">
      {elements.map((el, i) => <ElementChip key={`el${i}${el.selector}`} el={el} drop={() => drop(i)} />)}
      {comments.map((c, i) => (
        <Chip key={`c${i}${c.path}${c.line}`} size="sm" icon="comment" title={c.text} aria-label={`Remove comment on ${c.path}:${c.line}`} onClick={() => dropComment(i)}>
          {commentChip(c)}<Icon name="close" small />
        </Chip>
      ))}
      {marks.map((m, i) => {
        const { kind, path, name } = markChip(m);
        return (
          <Chip key={`${i}${m}`} size="sm" icon={kind === 'Image' ? 'file-media' : 'file'} title={path} aria-label={`Remove ${kind.toLowerCase()} ${name}`} onClick={() => remove(i)}>
            {name}<Icon name="close" small />
          </Chip>
        );
      })}
    </div>
  );
}
