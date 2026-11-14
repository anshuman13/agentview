import { send } from '../../app/store';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { plural } from '../../ui/util';
import type { ChatEvent, ReviewFile, ReviewHunk } from '../../../../shared/protocol';

type ReviewEvent = Extract<ChatEvent, { kind: 'review' }>;

const decide = (id: string, action: 'keep' | 'undo', file?: string, hunk?: number) => send({ type: 'review', id, action, file, hunk });

const STATE = { kept: 'Kept', undone: 'Undone' };

function Hunk({ id, file, k, h }: { id: string; file: string; k: number; h: ReviewHunk }) {
  return (
    <div className="rv-hunk">
      <pre className="pd-diff">
        <div className="pd-cut">Line {h.line}</div>
        {h.del.map((l, i) => <div key={`d${i}`} className="del">- {l}</div>)}
        {h.add.map((l, i) => <div key={`a${i}`} className="add">+ {l}</div>)}
      </pre>
      <div className="pd-actions">
        {h.state ? <span className="pd-hint">{STATE[h.state]}</span> : (
          <>
            <Button size="sm" variant="filled" onClick={() => decide(id, 'keep', file, k)}>Keep</Button>
            <Button size="sm" variant="gray" onClick={() => decide(id, 'undo', file, k)}>Undo</Button>
          </>
        )}
      </div>
    </div>
  );
}

function FileReview({ id, f }: { id: string; f: ReviewFile }) {
  const label = f.created ? 'New file' : f.large ? 'Too large to show, see Changes' : f.binary ? 'Binary file' : undefined;
  const undecided = f.hunks.length ? f.hunks.some((h) => !h.state) : !f.state;
  return (
    <div className="rv-file">
      <div className="pd-head">
        <Icon name="file" small />
        <span className="pd-path">{f.path}</span>
        {label && <span className="pd-hint">{label}</span>}
        <span className="pd-count">
          {undecided ? (
            <>
              <Button size="sm" variant="filled" onClick={() => decide(id, 'keep', f.path)}>Keep file</Button>
              {!f.binary && <Button size="sm" variant="gray" onClick={() => decide(id, 'undo', f.path)}>Undo file</Button>}
            </>
          ) : f.state && STATE[f.state]}
        </span>
      </div>
      {f.hunks.map((h, k) => <Hunk key={k} id={id} file={f.path} k={k} h={h} />)}
    </div>
  );
}

export function ReviewCard({ ev }: { ev: ReviewEvent }) {
  const count = ev.files.reduce((n, f) => n + (f.hunks.length || 1), 0);
  if (ev.result) {
    return (
      <div className="pd review-card">
        <div className="pd-head"><Icon name="check" small /><span className="pd-title">Reviewed {plural(count, 'change')}</span><span className="pd-count">{ev.result}</span></div>
      </div>
    );
  }
  return (
    <div className="pd review-card">
      <div className="pd-head">
        <Icon name="diff" small />
        <span className="pd-title">Review {plural(count, 'change')}</span>
        <Button size="sm" variant="filled" onClick={() => decide(ev.id, 'keep')}>Keep all</Button>
      </div>
      {ev.files.map((f) => <FileReview key={f.path} id={ev.id} f={f} />)}
    </div>
  );
}
