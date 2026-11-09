import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { send, setUi } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { Confirm, type ConfirmRequest } from '../../ui/Confirm';
import { BlockedCard } from '../../chat/cards/Pending';
import { Markdown } from '../../chat/Chat';
import { Row } from '../../chat/transcript/Transcript';
import { FileIcon } from '../../workspace/FileIcon';
import { relPath } from '../../chat/transcript/steps';
import { openFailures, type Turn } from '../../chat/transcript/turns';
import { openAgent } from '../agents';
import { REVIEW_LOCAL } from '../../ops/Findings';
import { plural } from '../../ui/util';
import { BIG_BRO, type PendingRequest } from '../../../../shared/protocol';
import { time } from './time';

const CLAUDE = <svg viewBox="0 0 16 16" width="12" height="12"><path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
const FILES_SHOWN = 6;

export function TurnCard({ turn, latest, live, cwd, pending }: { turn: Turn; latest: boolean; live: boolean; cwd: string; pending: PendingRequest[] }) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  const when = turn.queued ? <span className="tl-state" title="Waiting for Claude's next step"><Icon name="clock" small /><button className="link tl-send-now" title="Stop Claude's current step and send this now" onClick={(e) => { e.stopPropagation(); send({ type: 'send_now', id: turn.id }); }}>Send now</button></span> : turn.stopping ? <span className="tl-state" title="Stopping the current step"><Icon name="loading" small spin /></span> : <span className="when" title={new Date(turn.at).toLocaleString()}>{time(turn.at)}</span>;
  return (
    <section className={`tc ${latest ? 'latest' : ''}`}>
      {turn.prompt && (
        <div className={`tc-prompt ${turn.phase ? 'phase' : ''} ${promptOpen ? 'open' : ''}`} onClick={() => setPromptOpen((v) => !v)}>
          <span className="mark"><Icon name={turn.phase ? 'sync' : 'comment'} small /></span>
          <span className="text">{turn.prompt}</span>
          {when}
        </div>
      )}
      {turn.reply && <Reply text={turn.reply.text} clip={!latest} />}
      <Facts turn={turn} cwd={cwd} pending={pending} latest={latest && !live} settled={!live} />
      {turn.steps.length > 0 && (
        <button className="tc-steps-toggle" aria-expanded={stepsOpen} onClick={() => setStepsOpen((v) => !v)}>
          <Icon name={stepsOpen ? 'chevron-down' : 'chevron-right'} small />Steps ({turn.steps.length})
        </button>
      )}
      {stepsOpen && <div className="tr tc-steps">{turn.steps.map((it) => <Row key={it.id} it={it} cwd={cwd} settled={!live} />)}</div>}
    </section>
  );
}

function Reply({ text, clip }: { text: string; clip: boolean }) {
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (clip && body.current) setLong(body.current.scrollHeight > body.current.clientHeight + 2);
  }, [clip, text]);
  const cut = clip && !open;
  return (
    <div className="tc-reply">
      <span className="mark">{CLAUDE}</span>
      <div className="reply-card">
        <div ref={body} className={`reply-body ${!cut ? 'open' : long ? 'clipped' : ''}`}><Markdown text={text} /></div>
        {clip && (long || open) && <button className="link" onClick={() => setOpen((v) => !v)}>{open ? 'Show less' : 'Show more'}</button>}
      </div>
    </div>
  );
}

const rewindRequest = (turn: Turn): ConfirmRequest => ({
  title: 'Rewind files?',
  detail: `Puts every file Claude changed back to how it was before "${turn.prompt.split('\n')[0].slice(0, 80)}". Edits from later turns are undone too; the conversation stays.`,
  action: 'Rewind',
  icon: 'discard',
  run: async () => send({ type: 'rewind', id: turn.id }),
});

function Facts({ turn, cwd, pending, latest, settled }: { turn: Turn; cwd: string; pending: PendingRequest[]; latest: boolean; settled: boolean }) {
  const [allFiles, setAllFiles] = useState(false);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const [open, setOpen] = useState(false);
  const failed = openFailures(turn.commands);
  const refused = turn.commands.filter((c) => c.denied);
  const files = allFiles ? turn.files : turn.files.slice(0, FILES_SHOWN);
  const add = turn.files.reduce((n, f) => n + f.add, 0);
  const del = turn.files.reduce((n, f) => n + f.del, 0);
  const grouped = turn.files.length || turn.commits.length || turn.commands.length || turn.agents.length;
  const any = pending.length || turn.blocked.length || turn.notes.length || grouped;
  if (!any) return null;
  const delta = <><span className="add">+{add}</span> <span className="del">-{del}</span></>;
  const cmdIssues = <>{failed.length > 0 && <span className="tc-bad">, {failed.length} failed</span>}{refused.length > 0 && <span className="tc-muted">, {refused.length} denied</span>}</>;
  const summary = [
    turn.files.length > 0 && <>{plural(turn.files.length, 'file')} {delta}</>,
    turn.commits.length > 0 && plural(turn.commits.length, 'commit'),
    turn.commands.length > 0 && <>{plural(turn.commands.length, 'command')}{cmdIssues}</>,
    turn.agents.length > 0 && plural(turn.agents.length, 'agent'),
  ].filter(Boolean);
  const folded = settled && grouped && !open;
  return (
    <div className="tc-facts">
      {pending.map((p) => (
        <div key={p.id} className="tc-wait"><Icon name="bell-dot" small /><span>{p.kind === 'question' ? p.questions[0]?.question ?? 'Claude has a question' : p.title}</span></div>
      ))}
      {turn.blocked.map((b) => <BlockedCard key={b.id} ev={b} />)}
      {turn.notes.length > 0 && (
        <ul className="tc-notes">
          {turn.notes.map((n) => (
            <li key={n.id} className={`tc-note ${n.kind}`}>
              <span className="mark">{n.kind === 'important' ? <i className="dot" /> : <Icon name={n.kind === 'fable' ? 'sparkle' : 'check'} small />}</span>
              <span className="text">{n.kind === 'fable' && <b>Fable: </b>}{n.text}</span>
            </li>
          ))}
        </ul>
      )}
      {settled && grouped && (
        <button className="tc-facts-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} small />
          {summary.map((part, i) => <Fragment key={i}>{i > 0 && ' · '}{part}</Fragment>)}
        </button>
      )}
      {!folded && (
        <>
          {turn.files.length > 0 && (
            <div className="tc-group">
              <div className="tc-label">{plural(turn.files.length, 'file')} changed <span className="tr-count">{delta}</span></div>
              {files.map((f) => {
                const rel = relPath(f.path, cwd);
                const cut = rel.lastIndexOf('/');
                const name = rel.slice(cut + 1);
                return (
                  <button key={f.path} className="tc-file" title={rel} onClick={() => setUi({ openFile: rel, follow: false })}>
                    <FileIcon name={name} />
                    <span className="tr-path"><span className="tr-dir">{cut >= 0 ? rel.slice(0, cut + 1) : ''}</span>{name}</span>
                    <span className="tr-count"><span className="add">+{f.add}</span> <span className="del">-{f.del}</span></span>
                  </button>
                );
              })}
              {turn.files.length > FILES_SHOWN && <button className="link" onClick={() => setAllFiles((v) => !v)}>{allFiles ? 'Show fewer' : `${turn.files.length - FILES_SHOWN} more`}</button>}
              {latest && <button className="link" title="Claude reviews the working tree, findings show in the Changes view" onClick={() => send({ type: 'prompt', text: REVIEW_LOCAL })}>Review changes</button>}
              {settled && <button className="link" title="Put the files back to how they were before this prompt" onClick={() => setAsk(rewindRequest(turn))}>Rewind files</button>}
              {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
            </div>
          )}
          {turn.commits.length > 0 && (
            <div className="tc-group">
              {turn.commits.map((c) => (
                <div key={c.hash} className="tc-commit" title={c.hash}><Icon name="git-commit" small /><code>{c.hash.slice(0, 7)}</code><span className="text">{c.subject}</span></div>
              ))}
            </div>
          )}
          {turn.commands.length > 0 && (
            <div className="tc-group">
              <div className="tc-label">Ran {plural(turn.commands.length, 'command')}{cmdIssues}</div>
              {failed.map((c) => (
                <div key={c.id} className="tc-fail" title={c.error}><span className="tc-cmd">{c.label}</span><span className="tc-err">{c.error}</span></div>
              ))}
              {refused.map((c) => (
                <div key={c.id} className="tc-fail denied" title="You denied this command"><span className="tc-cmd">{c.label}</span><span className="tc-err">Denied</span></div>
              ))}
            </div>
          )}
          {turn.agents.length > 0 && (
            <div className="tc-agents">
              {turn.agents.map((a) => (
                <button key={a.id} className={`tc-agent ${a.state}`} title={a.label} onClick={() => openAgent(a.id)}>
                  <i className="tr-ring" /><span className="name">{a.type === BIG_BRO ? `Fable: ${a.label}` : a.label}</span><span className="state">{a.state}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
