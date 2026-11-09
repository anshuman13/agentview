import { Hl } from '../ui/util';
import { FileIcon } from '../workspace/FileIcon';
import type { SavedSession } from '../../../shared/protocol';

type Props = {
  items: { item: string | object; hits: number[] }[];
  kind: string | undefined;
  popId: string;
  sel: number;
  choose: (i: number) => void;
};

export function PopItems({ items, kind, popId, sel, choose }: Props) {
  return <>{items.map((r, i) => {
    if (kind === 'command') {
      const c = r.item as { name: string; description: string };
      return (
        <li key={c.name} id={`${popId}-${i}`} role="option" aria-selected={i === sel} className={i === sel ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); choose(i); }}>
          <span className="cp-name">/<Hl text={c.name} hits={r.hits} /></span>
          <span className="cp-detail">{c.description}</span>
        </li>
      );
    }
    if (typeof r.item === 'object' && 'sessionId' in r.item) {
      const c = r.item as SavedSession;
      return (
        <li key={c.sessionId} id={`${popId}-${i}`} role="option" aria-selected={i === sel} className={i === sel ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); choose(i); }}>
          <span className="cp-name"><Hl text={c.title} hits={r.hits} /></span>
          <span className="cp-detail">{c.cwd.split('/').pop()}</span>
        </li>
      );
    }
    const f = r.item as string;
    const base = f.lastIndexOf('/') + 1;
    return (
      <li key={f} id={`${popId}-${i}`} role="option" aria-selected={i === sel} className={i === sel ? 'active' : ''} title={f} onMouseDown={(e) => { e.preventDefault(); choose(i); }}>
        <FileIcon name={f} />
        <span className="cp-name"><Hl text={f.slice(base)} hits={r.hits} from={base} /></span>
        <span className="cp-detail"><Hl text={f.slice(0, Math.max(base - 1, 0))} hits={r.hits} /></span>
      </li>
    );
  })}</>;
}
