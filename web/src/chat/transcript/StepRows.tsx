import { useState } from 'react';
import { setUi } from '../../app/store';
import { stopTask } from '../chatActions';
import { Icon } from '../../ui/Icon';
import { Markdown } from '../Chat';
import { CopyPathItems } from '../../workspace/CopyPathItems';
import { FileIcon } from '../../workspace/FileIcon';
import { Diff } from '../cards/Pending';
import { editPairs } from '../../../../shared/edits';
import { LinkAction, TranscriptBox } from './Box';
import { Badge } from '../../ui/Badge';
import { agentSummary } from '../../sessions/agents';
import { denied, duration, exploreLabel, firstLine, relPath, stepLabel, stepTone, type Item, type StepItem, type ToolResult, type ToolUse } from './steps';
import { clickOnKey, plural } from '../../ui/util';
import { editMarks, type EditCount } from '../../../../shared/edits';
import { useCan } from '../useCan';
import { Row } from './Transcript';

export function Explored({ id, run, cwd }: { id: string; run: StepItem[]; cwd: string }) {
  return (
    <TranscriptBox id={`explore:${id}`} title={`Explored ${exploreLabel(run)}`}>
      <div className="tr-explored">{run.map((s) => <Row key={s.id} it={s} cwd={cwd} />)}</div>
    </TranscriptBox>
  );
}

const STEP_ICONS = { read: 'eye', edit: 'edit', run: 'terminal', web: 'globe', mcp: 'plug', agent: 'sparkle', other: 'tools' } as const;

export function Step({ use, result, cwd, settled }: { use: ToolUse; result?: ToolResult; cwd: string; settled?: boolean }) {
  const [open, setOpen] = useState(false);
  const { verb, object, mono, cmd } = stepLabel(use.name, use.input, cwd);
  const state = !result ? (settled ? 'idle' : 'pending') : denied(result) ? 'denied' : result.isError ? 'err' : 'ok';
  const dur = result ? duration(result.at - use.at) : '';
  const tone = stepTone(use.name);
  return (
    <div className={`tr-step tr-act t-${tone} ${state} ${open ? 'open' : ''}`} onClick={() => setOpen((v) => !v)}>
      <span className="tr-mark">{state === 'pending' ? <Icon name="loading" small spin /> : <Icon name={STEP_ICONS[tone]} small />}</span>
      <span className="tr-text" title={object} role="button" tabIndex={0} aria-expanded={open} onKeyDown={clickOnKey}>{verb && <span className="tr-verb">{verb} </span>}<span className={`tr-obj ${mono ? 'mono' : ''}`}>{object}</span></span>
      <span className="tr-dur">{dur}</span>
      <span className="tr-chev"><Icon name={open ? 'chevron-down' : 'chevron-right'} small /></span>
      {cmd && !open && <span className="tr-cmd" title={cmd}>$ {cmd.replace(/\s*\n\s*/g, ' ⏎ ')}</span>}
      {state === 'err' && !open && <span className="tr-err">{firstLine(result!.text) || 'Failed'}</span>}
      {state === 'denied' && !open && <span className="tr-err">Denied</span>}
      {open && <Detail use={use} result={result} />}
    </div>
  );
}

function Detail({ use, result }: { use: ToolUse; result?: ToolResult }) {
  const input = typeof use.input.command === 'string' ? use.input.command : JSON.stringify(use.input, null, 2);
  const pairs = editPairs(use.name, use.input);
  return (
    <div className="tr-detail" onClick={(e) => e.stopPropagation()}>
      {pairs ? pairs.map(([a, b], n) => <Diff key={n} a={a} b={b} />) : <pre>{input}</pre>}
      {result && <pre className={result.isError && !denied(result) ? 'err' : ''}>{result.text || '(no output)'}</pre>}
    </div>
  );
}


// "+12 −3" in the diff colours, each part left out when 0.
export function EditMarks({ count }: { count: EditCount }) {
  const { add, del } = editMarks(count);
  if (!add && !del) return null;
  return <span className="tr-count">{add && <span className="add">{add}</span>}{add && del && ' '}{del && <span className="del">{del}</span>}</span>;
}

export function FileCard({ it, cwd }: { it: Extract<Item, { kind: 'file' }>; cwd: string }) {
  const rel = relPath(it.path, cwd);
  const cut = rel.lastIndexOf('/');
  const name = rel.slice(cut + 1);
  const open = () => setUi({ openFile: rel, follow: false });
  return (
    <TranscriptBox
      id={`file:${it.id}`}
      className={it.denied ? 'denied' : it.error ? 'err' : undefined}
      icon={<FileIcon name={name} />}
      title={name}
      meta={it.error ? <span className="tr-err">{it.error}</span> : <>{cut >= 0 && <span className="tr-dir">{rel.slice(0, cut + 1)} </span>}<EditMarks count={it.count} /></>}
      action={<LinkAction label="Open" onClick={open} />}
      onOpen={it.error ? open : undefined}
      menu={<CopyPathItems path={it.path} cwd={cwd} />}
    >
      <div className="tr-diffs">{it.uses.flatMap((u) => editPairs(u.name, u.input) ?? []).map(([a, b], n) => <Diff key={n} a={a} b={b} />)}</div>
    </TranscriptBox>
  );
}

export function AgentRow({ it, cwd }: { it: Extract<Item, { kind: 'agent' }>; cwd: string }) {
  const { use, result, steps, running } = it;
  const canStop = useCan('stopTask');
  const desc = typeof use.input.description === 'string' && use.input.description ? use.input.description : 'Sub-agent';
  const type = typeof use.input.subagent_type === 'string' ? use.input.subagent_type : '';
  const dur = result && !running ? duration(result.at - use.at) : '';
  const badge = running ? <Badge status="running" /> : result?.stopped ? <Badge status="skipped" reason="Stopped" /> : denied(result) ? <Badge status="skipped" reason="Denied" /> : result?.isError ? <Badge status="failed" /> : <Badge status="done" />;
  return (
    <TranscriptBox
      id={`agent:${use.id}`}
      className={running ? 'running' : undefined}
      title={desc}
      meta={[type, dur, steps.length > 0 && plural(steps.length, 'step')].filter(Boolean).join(' · ')}
      state={badge}
      icon={<Icon name="sparkle" />}
      action={running && canStop ? <LinkAction label="Stop" title="Stop this agent" onClick={() => stopTask(use.id)} /> : undefined}
      summary={agentSummary(it)}
    >
      {steps.length > 0 && <div className="tr-sub">{steps.map((s) => <Row key={s.id} it={s} cwd={cwd} settled={!running} />)}</div>}
      {result && !running && <div className="tr-report"><Markdown text={result.text || '(no output)'} id={it.id} /></div>}
    </TranscriptBox>
  );
}
