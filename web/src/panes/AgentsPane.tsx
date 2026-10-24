import { send, useStore } from '../store';
import { Icon } from '../Icon';
import { Markdown } from './Chat';
import { Row } from './Transcript';
import { agentCounts, agentsOf, elapsed, tokens, type Agent } from './agents';
import { plural, useTick } from './util';
import type { AgentStatus } from '../../../shared/protocol';

const useAgents = () => useStore((s) => agentsOf(s.events));

export const openAgent = (id: string | null = null) => window.dispatchEvent(new CustomEvent('open-agent', { detail: id }));

const STATUS_ICON: Record<AgentStatus, string> = { running: 'loading', done: 'check', failed: 'error', stopped: 'debug-stop' };

const took = (a: Agent, now: number) => elapsed((a.endedAt ?? now) - a.startedAt);

export function AgentsChip() {
  const agents = useAgents();
  if (!agents.length) return null;
  const { running, done } = agentCounts(agents);
  const text = [running && `${running} running`, done && `${done} done`].filter(Boolean).join(', ');
  return (
    <button className={`ag-chip ${running ? 'running' : ''}`} title="Show the agents" onClick={() => openAgent()}>
      <Icon name={running ? 'loading' : 'hubot'} small spin={running > 0} /> {text}
    </button>
  );
}

export function AgentsBadge() {
  const running = agentCounts(useAgents()).running;
  return running > 0 ? <span className="badge running">{running}</span> : null;
}

export function AgentsPane({ selected, onSelect, stack }: { selected: string | null; onSelect: (id: string | null) => void; stack?: boolean }) {
  const agents = useAgents();
  const cwd = useStore((s) => s.session.cwd);
  const now = useTick(1000, agents.some((a) => a.status === 'running'));
  const list = [...agents].reverse();
  const current = agents.find((a) => a.id === selected) ?? list[0];

  if (!agents.length) {
    return (
      <div className="empty-state">
        <Icon name="hubot" />
        <div className="empty-title">No agents yet</div>
        <div className="muted small">Sub-agents Claude starts in this chat show up here, with their prompt, steps and report.</div>
      </div>
    );
  }

  return (
    <div className={`ag ${stack ? 'stack' : ''} ${selected && current?.id === selected ? 'picked' : ''}`}>
      <ul className="ag-list">
        {list.map((a) => {
          const last = (a.status === 'running' && a.info?.progress) || a.lastStep;
          const sub = [a.status, a.steps.length > 0 && plural(a.steps.length, 'step'), last].filter(Boolean).join(' · ');
          return (
            <li key={a.id} className={`ag-row ${a.status} ${a.id === current?.id ? 'active' : ''}`} onClick={() => onSelect(a.id)}>
              <span className={`ag-mark ${a.status}`}><Icon name={STATUS_ICON[a.status]} small spin={a.status === 'running'} /></span>
              <span className="ag-name" title={a.description}>{a.description}</span>
              <span className="ag-time">{took(a, now)}</span>
              <span className="ag-sub" title={sub}>{sub}</span>
            </li>
          );
        })}
      </ul>
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
      <header className="ag-head">
        <div className="ag-title">
          <span className={`ag-mark ${a.status}`}><Icon name={STATUS_ICON[a.status]} small spin={running} /></span>
          <h2 title={a.description}>{a.description}</h2>
          {running && (
            <button className="ag-stop" title="Stop this agent" onClick={() => send({ type: 'stop_task', toolUseId: a.id })}>
              <Icon name="debug-stop" small /> Stop
            </button>
          )}
        </div>
        <div className="ag-meta">{meta.join(' · ')}</div>
        {running && a.info?.progress && <div className="ag-progress">{a.info.progress}</div>}
        {running && <div className="muted small" title={new Date(a.lastAt).toLocaleString()}>Last activity {elapsed(now - a.lastAt)} ago{a.lastStep && ` · ${a.lastStep}`}</div>}
      </header>
      <section className="ag-report">
        {running ? <div className="muted small">The report shows here when the agent finishes.</div> : <Markdown text={a.result?.text || '(no report)'} />}
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
