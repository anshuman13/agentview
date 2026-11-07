import { send, useStore } from '../app/store';
import { Back } from '../app/back';
import { Button, Chip } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { EmptyState } from '../ui/Panel';
import { Section } from '../ui/Section';
import { Row as UiRow } from '../ui/Row';
import { Markdown } from '../chat/Chat';
import { Row } from '../chat/Transcript';
import { copyText } from '../codex/view';
import { agentCounts, agentsOf, elapsed, openAgent, reportText, tokens, type Agent } from './agents';
import { plural, useTick } from '../ui/util';
import type { AgentStatus } from '../../../shared/protocol';

const useAgents = () => useStore((s) => agentsOf(s.events));

const STATUS_ICON: Record<AgentStatus, string> = { running: 'loading', done: 'check', failed: 'error', stopped: 'debug-stop' };

const took = (a: Agent, now: number) => elapsed((a.endedAt ?? now) - a.startedAt);

export function AgentsChip() {
  const agents = useAgents();
  if (!agents.length) return null;
  const { running, done } = agentCounts(agents);
  const text = [running && `${running} running`, done && `${done} done`].filter(Boolean).join(', ');
  const short = [running, done].filter(Boolean).join(' / ');
  return (
    <Chip className={running ? 'agent' : undefined} title={`Show the agents: ${text}`} aria-label={text} onClick={() => openAgent()}>
      <Icon name={running ? 'loading' : 'hubot'} small spin={running > 0} /> <span className="chip-full">{text}</span><span className="chip-short">{short}</span>
    </Chip>
  );
}

export function AgentsPane({ selected, onSelect, stack }: { selected: string | null; onSelect: (id: string | null) => void; stack?: boolean }) {
  const agents = useAgents();
  const cwd = useStore((s) => s.session.cwd);
  const now = useTick(1000, agents.some((a) => a.status === 'running'));
  const list = [...agents].reverse();
  const current = agents.find((a) => a.id === selected) ?? list[0];

  if (!agents.length) {
    return (
      <EmptyState size="md" icon="hubot" title="No agents yet" hint="Sub-agents Claude starts in this chat show up here, with their prompt, steps and report." />
    );
  }

  return (
    <div className={`ag ${stack ? 'stack' : ''} ${selected && current?.id === selected ? 'picked' : ''}`}>
      {selected && current?.id === selected && (stack || matchMedia('(max-width: 900px)').matches) && <Back close={() => onSelect(null)} />}
      <div className="ag-side">
        <Section label="Agents" count={list.length} />
        {list.map((a) => {
          const last = (a.status === 'running' && a.info?.progress) || a.lastStep;
          const sub = [a.status, a.steps.length > 0 && plural(a.steps.length, 'step'), last].filter(Boolean).join(' · ');
          return (
            <UiRow
              key={a.id}
              className="ag-item"
              aria-current={a.id === current?.id ? 'true' : undefined}
              leading={<span className={`ag-mark ${a.status}`}><Icon name={STATUS_ICON[a.status]} small spin={a.status === 'running'} /></span>}
              title={<span title={a.description}>{a.description}</span>}
              meta={<span title={sub}>{sub}</span>}
              trailing={took(a, now)}
              onClick={() => onSelect(a.id)}
            />
          );
        })}
      </div>
      {current && <AgentDetail key={current.id} a={current} cwd={cwd} now={now} stack={stack} onBack={() => onSelect(null)} />}
    </div>
  );
}

function AgentDetail({ a, cwd, now, stack, onBack }: { a: Agent; cwd: string; now: number; stack?: boolean; onBack: () => void }) {
  const running = a.status === 'running';
  const usage = a.info?.usage;
  const meta = [a.type, a.model, took(a, now), usage && tokens(usage.tokens), usage && plural(usage.toolUses, 'tool use'), a.info?.background && 'background'].filter(Boolean);
  return (
    <div className="ag-detail">
      <button className={`ag-back ${stack ? '' : 'mobile-only'}`} onClick={onBack}><Icon name="arrow-left" small /> Agents</button>
      <Section
        label={<><span className={`ag-mark ${a.status}`}><Icon name={STATUS_ICON[a.status]} small spin={running} /></span> <span title={a.description}>{a.description}</span></>}
        action={running && <Button size="sm" icon="debug-stop" title="Stop this agent" onClick={() => send({ type: 'stop_task', toolUseId: a.id })}>Stop</Button>}
      />
      <div className="ag-meta">{meta.join(' · ')}</div>
      {running && a.info?.progress && <div className="ag-progress">{a.info.progress}</div>}
      {running && <div className="muted small" title={new Date(a.lastAt).toLocaleString()}>Last activity {elapsed(now - a.lastAt)} ago{a.lastStep && ` · ${a.lastStep}`}</div>}
      <section className="ag-report">
        {running ? <div className="muted small">The report shows here when the agent finishes.</div> : <><Markdown text={reportText(a)} /><button className="btn sm" onClick={() => copyText(reportText(a), 'Report copied')}><Icon name="copy" small /> Copy report</button></>}
      </section>
      {a.prompt && (
        <details className="ag-prompt">
          <summary>Prompt</summary>
          <Markdown text={a.prompt} />
        </details>
      )}
      <section className="ag-steps">
        <div className="ag-label">Steps ({a.steps.length})</div>
        {a.steps.length === 0 && <div className="muted small">No steps yet.</div>}
        <div className="ag-steps-list">{a.steps.map((s) => <Row key={s.id} it={s} cwd={cwd} settled={!running} />)}</div>
      </section>
    </div>
  );
}
