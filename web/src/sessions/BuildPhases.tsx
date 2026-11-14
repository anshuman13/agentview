import { createPortal } from 'react-dom';
import { useRef, useState } from 'react';
import { notice, sendToChat, useStore } from '../app/store';
import { track } from '../app/featureUse';
import { Markdown } from '../chat/Chat';
import { AskRow } from '../ui/AskRow';
import { Badge } from '../ui/Badge';
import { Button, Chip, IconButton } from '../ui/Button';
import { Menu, MenuItem } from '../ui/Menu';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { Sheet } from '../ui/Sheet';
import { ago } from '../ui/util';
import { decisionTitle, phaseLabel, reviewDecision, withoutCriteria, type BuildPhase, type BuildReview, type ReviewPhase } from '../../../shared/builds';
import { runAllPrompt, specProgress, specTasks, startTaskPrompt, withoutOpenTasks } from '../../../shared/specTasks';
import { nextPhase, startPhase } from './buildsLogic';
import { useThemeName } from '../app/theme';
import { SketchFrame, type Device } from '../workspace/Sketches';
import { postBuildReview } from './sessionApi';

function ChangesSheet({ phase, onSend, onClose }: { phase: ReviewPhase | 'code'; onSend: (note: string) => Promise<void>; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [failed, setFailed] = useState(false);
  const send = () => void onSend(note.trim()).then(onClose, () => setFailed(true));
  return (
    <Sheet label="Request changes" onClose={onClose} className="gl-sheet">
      <Section label={`Request changes · ${phaseLabel(phase)}`} />
      <div className="ui-group">
        <div className="ui-fields">
          <textarea rows={4} autoFocus aria-label="What should change?" placeholder="What should change?" value={note} onChange={(e) => { setNote(e.target.value); setFailed(false); }} />
          {failed && <div className="gl-note err" role="alert">Could not save the review. Your note is still here.</div>}
        </div>
      </div>
      <div className="gl-actions">
        <Button size="sm" variant="filled" disabled={!note.trim()} onClick={send}>Send</Button>
      </div>
    </Sheet>
  );
}

// The user's latest decision on a phase or on the code, with Approve and a menu that opens the changes note.
export function DecisionRow({ slug, phase, review, onSaved, onApproved }: { slug: string; phase: ReviewPhase | 'code'; review: BuildReview | undefined; onSaved: () => Promise<void>; onApproved?: () => void }) {
  const [asking, setAsking] = useState(false);
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const save = (decision: 'approve' | 'changes', note: string) => postBuildReview(slug, phase, decision, note).then(onSaved);
  const approve = () => {
    track('action:approveSpec');
    return save('approve', '').then(() => onApproved?.(), () => notice('Could not save the review. Try again.'));
  };
  return (
    <div className="bd-clamp">
      <AskRow
        title={decisionTitle(review)}
        meta={review && [ago(review.at, ' ago'), review.note].filter(Boolean).join(' · ')}
        actions={(
          <>
            <Button size="sm" variant="filled" onClick={approve}>Approve</Button>
            <span className="ov-more">
              <IconButton ref={more} size="sm" icon="kebab-vertical" label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
              {menu && <Menu trigger={more} onClose={() => setMenu(false)}><MenuItem onClick={() => { setMenu(false); setAsking(true); }}>Request changes</MenuItem></Menu>}
            </span>
          </>
        )}
      />
      {asking && createPortal(<ChangesSheet phase={phase} onSend={(note) => save('changes', note)} onClose={() => setAsking(false)} />, document.body)}
    </div>
  );
}

// The build's sketch in a phone or desktop frame, in the app's theme.
function SketchPhase({ slug, html }: { slug: string; html: string }) {
  const [device, setDevice] = useState<Device>('phone');
  const theme = useThemeName();
  return (
    <>
      <div className="gl-chips bd-doc">
        {(['phone', 'desktop'] as const).map((d) => <Chip key={d} size="sm" on={device === d} onClick={() => setDevice(d)}>{d === 'phone' ? 'Phone' : 'Desktop'}</Chip>)}
      </div>
      <div className="bd-sketch"><SketchFrame name={`${slug}.html`} html={html} device={device} theme={theme} fitWidth /></div>
    </>
  );
}

// The spec as the phase strip shows it, with the user's latest decision on the shown phase under it.
// The criteria show on the card itself, so the phase text leaves them out.
export function BuildPhases({ slug, phases, reviews, specPath, initial, onSaved }: { slug: string; phases: BuildPhase[]; reviews: BuildReview[]; specPath: string | null; initial?: ReviewPhase; onSaved: () => Promise<void> }) {
  const [picked, setPicked] = useState<ReviewPhase | null>(null);
  const [runMenu, setRunMenu] = useState(false);
  const runBox = useRef<HTMLButtonElement>(null);
  const chat = useStore((s) => s.session.id);
  if (!phases.length) return null;
  const first = phases.some((p) => p.key === initial) ? initial : startPhase(phases, reviews);
  const phase = phases.find((p) => p.key === (picked ?? first)) ?? phases[0];
  const review = reviewDecision(reviews, phase.key);
  const tasks = phase.key === 'tasks' ? specTasks(phase.markdown) : [];
  const open = tasks.filter((t) => !t.done);
  const runnable = specPath && chat && open.length > 0 ? specPath : null;
  const markdown = phase.key !== 'sketch' ? withoutCriteria(phase.markdown) : phase.markdown;
  return (
    <>
      <Section label="Spec" action={<>{tasks.length > 0 && <span className="muted small">{specProgress(tasks)}</span>}{runnable && (
        <span className="ov-more">
          <IconButton ref={runBox} size="sm" icon="kebab-vertical" label="More" aria-haspopup="menu" aria-expanded={runMenu} onClick={() => setRunMenu(!runMenu)} />
          {runMenu && <Menu trigger={runBox} onClose={() => setRunMenu(false)}><MenuItem onClick={() => { setRunMenu(false); track('action:runAll'); sendToChat(runAllPrompt(runnable)); }}>Run all</MenuItem></Menu>}
        </span>
      )}</>} />
      <div className="gl-chips bd-phases">
        {phases.map((p) => <Chip key={p.key} on={p.key === phase.key} icon={reviewDecision(reviews, p.key)?.decision === 'approve' ? 'check' : undefined} onClick={() => setPicked(p.key)}>{phaseLabel(p.key)}</Chip>)}
      </div>
      <div className="ui-group">
        {phase.key === 'sketch' ? <SketchPhase slug={slug} html={phase.markdown} /> : <div className="bd-doc"><Markdown text={runnable ? withoutOpenTasks(markdown) : markdown} /></div>}
        {runnable && open.map((t) => <Row key={t.n} plain className="bd-clamp" title={t.text} trailing={t.doing ? <Badge status="running" /> : <Button size="sm" onClick={() => { track('action:startTask'); sendToChat(startTaskPrompt(t, runnable)); }}>Start</Button>} />)}
        <DecisionRow slug={slug} phase={phase.key} review={review} onSaved={onSaved} onApproved={() => setPicked(nextPhase(phases, phase.key))} />
      </div>
    </>
  );
}
