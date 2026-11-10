import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { notice } from '../app/store';
import { AskRow } from '../ui/AskRow';
import { Badge } from '../ui/Badge';
import { Button, IconButton } from '../ui/Button';
import { Confirm, type ConfirmRequest } from '../ui/Confirm';
import { Counts, Files, splitDiff } from '../ui/DiffFiles';
import { Menu, MenuItem } from '../ui/Menu';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { Sheet } from '../ui/Sheet';
import { Skeleton } from '../ui/Skeleton';
import { ago } from '../ui/util';
import type { ChatRun } from '../../../shared/protocol';
import { errText } from '../../../shared/util';
import { openRun } from './goalLogic';
import { fetchRunDiff, postRunApprove, postRunDiscard, postRunRevise, type RunDiff } from './sessionApi';

const SHOWN = 3;

function ReviseSheet({ onSend, onClose }: { onSend: (text: string) => Promise<unknown>; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [failed, setFailed] = useState(false);
  const send = () => void onSend(note.trim()).then(onClose, () => setFailed(true));
  return (
    <Sheet label="Revise" onClose={onClose} className="gl-sheet">
      <Section label="Revise" />
      <div className="ui-group">
        <div className="ui-fields">
          <textarea rows={4} autoFocus aria-label="What should change?" placeholder="What should change?" value={note} onChange={(e) => { setNote(e.target.value); setFailed(false); }} />
          {failed && <div className="gl-note err" role="alert">Could not send the note. Your note is still here.</div>}
        </div>
      </div>
      <div className="gl-actions">
        <Button size="sm" variant="filled" disabled={!note.trim()} onClick={send}>Send</Button>
      </div>
    </Sheet>
  );
}

export function ReviewFiles({ diff, all, onAll }: { diff: RunDiff; all: boolean; onAll: () => void }) {
  const diffs = useMemo(() => splitDiff(diff.diff), [diff.diff]);
  return (
    <>
      <Files files={all ? diff.files : diff.files.slice(0, SHOWN)} diffs={diffs} />
      {!all && diff.files.length > SHOWN && <Row plain title={<Button size="sm" variant="quiet" onClick={onAll}>Show all {diff.files.length}</Button>} />}
    </>
  );
}

export function ReviewCard({ run }: { run: ChatRun }) {
  const [diff, setDiff] = useState<RunDiff | null>(null);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  const [all, setAll] = useState(false);
  const [menu, setMenu] = useState(false);
  const [revising, setRevising] = useState(false);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const [approving, setApproving] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setFailed(false);
    setDiff(null);
    void fetchRunDiff(run.id).then(setDiff, () => setFailed(true));
  }, [run.id, tries]);
  const last = run.rounds.at(-1);
  const meta = (
    <>
      {run.branch}
      {diff && <> · <Counts a={diff.files.reduce((n, f) => n + f.additions, 0)} d={diff.files.reduce((n, f) => n + f.deletions, 0)} /> · {diff.files.length} {diff.files.length === 1 ? 'file' : 'files'}</>}
      {' · '}{ago(last?.at ?? run.startedAt, ' ago')}
    </>
  );
  const approve = () => setAsk({
    title: `Push ${run.branch} and open a PR?`,
    detail: 'Nothing is merged.',
    action: 'Approve',
    icon: 'git-pull-request',
    neutral: true,
    run: async () => {
      setApproving(true);
      await postRunApprove(run.id).catch((err) => notice(`Could not open the PR: ${errText(err)}`));
      setApproving(false);
    },
  });
  const discard = () => setAsk({
    title: 'Discard this run?',
    detail: 'The worktree and its branch are deleted.',
    action: 'Discard',
    run: () => postRunDiscard(run.id).catch((err) => notice(`Could not discard the run: ${errText(err)}`)),
  });
  const pick = (fn: () => void) => () => { setMenu(false); fn(); };
  return (
    <>
      <Section label={run.title} />
      <div className="ui-group">
        <Row title={last?.line || run.title} meta={meta} state={<Badge status="waiting" label="Needs you" />} onClick={() => openRun(run)} onLongPress={() => setMenu(true)} />
        {failed ? <Row plain title="Could not load the diff" trailing={<Button size="sm" onClick={() => setTries(tries + 1)}>Retry</Button>} /> : diff ? <ReviewFiles diff={diff} all={all} onAll={() => setAll(true)} /> : <Skeleton rows={3} />}
        <AskRow
          title="Commit, push and open a PR"
          actions={(
            <>
              <Button size="sm" variant="filled" disabled={approving} onClick={approve}>{approving ? 'Approving…' : 'Approve'}</Button>
              <span className="ov-more">
                <IconButton ref={more} size="sm" icon="kebab-vertical" label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
                {menu && (
                  <Menu trigger={more} onClose={() => setMenu(false)}>
                    <MenuItem onClick={pick(() => setRevising(true))}>Revise…</MenuItem>
                    <MenuItem onClick={pick(() => openRun(run))}>Open chat</MenuItem>
                    <MenuItem danger onClick={pick(discard)}>Discard</MenuItem>
                  </Menu>
                )}
              </span>
            </>
          )}
        />
      </div>
      {revising && createPortal(<ReviseSheet onSend={(text) => postRunRevise(run.id, text)} onClose={() => setRevising(false)} />, document.body)}
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </>
  );
}
