import { Fragment } from 'react';
import { send, useStore } from '../app/store';
import { Back } from '../app/touch/back';
import { Button, Chip } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { EmptyState } from '../ui/Panel';
import { Section } from '../ui/Section';
import { AgentRow, STATUS_ICON } from './AgentRow';
import { Markdown } from '../chat/Chat';
import { Row } from '../chat/transcript/Transcript';
import { copyText } from '../codex/view';
import { agentCounts, agentsOf, elapsed, openAgent, reportText, tokens, type Agent } from './agents';
import { plural, useTick } from '../ui/util';
import { useCan } from '../chat/useCan';
import type { AgentStatus } from '../../../shared/protocol';

const useAgents = () => useStore((s) => agentsOf(s.events));

const STATUS_LABEL: Record<AgentStatus, string> = { running: 'Running', done: 'Done', failed: 'Failed', stopped: 'Stopped' };

const took = (a: Agent, now: number) => elapsed((a.endedAt ?? now) - a.startedAt);

export function AgentsPane({ selected, onSelect, stack }: { selected: string | null; onSelect: (id: string | null) => void; stack?: boolean }) {
  const agents = useAgents();
  const cwd = useStore((s) => s.session.cwd);
  const now = useTick(1000, agents.some((a) => a.status === 'running'));
  const list = [...agents].reverse();
  const groups = [...new Set(list.map((a) => a.group))].map((g) => [g, list.filter((a) => a.group === g)] as const).sort(([a], [b]) => Number(a !== undefined) - Number(b !== undefined));
  const current = agents.find((a) => a.id === selected) ?? list[0];

  if (!agents.length) {
    return (
      <EmptyState size="md" icon="hubot" title="No agents yet" hint="Sub-agents Claude starts in this chat show up here, with their prompt, steps and report" />
    );
  }

  const agentRow = (a: Agent) => {
    const last = (a.status === 'running' && a.info?.progress) || a.lastStep;
    const sub = [a.group ? STATUS_LABEL[a.status] : a.status, a.steps.length > 0 && plural(a.steps.length, 'step'), last].filter(Boolean).join(' · ');
    return (
      <AgentRow
        key={a.id}
        status={a.status}
        description={a.description}
        meta={sub}
        trailing={a.group && a.info?.usage ? `${took(a, now)} · ${tokens(a.info.usage.tokens)}` : took(a, now)}
        current={a.id === current?.id}
        onClick={() => onSelect(a.id)}
      />
    );
  };

  return (
    <div className={`ag ${stack ? 'stack' : ''} ${selected && current?.id === selected ? 'picked' : ''}`}>
      {selected && current?.id === selected && (stack || matchMedia('(max-width: 900px)').matches) && <Back close={() => onSelect(null)} />}
      <div className="ag-side">
        {groups.map(([name, rows]) => (
          <Fragment key={name ?? ''}>
            <Section label={name ?? 'Agents'} count={rows.length} />
            <div className="as-group">{rows.map((a) => agentRow(a))}</div>
          </Fragment>
        ))}
      </div>
      {current && <AgentDetail key={current.id} a={current} cwd={cwd} now={now} stack={stack} onBack={() => onSelect(null)} />}
    </div>
  );
}

function AgentDetail({ a, cwd, now, stack, onBack }: { a: Agent; cwd: string; now: number; stack?: boolean; onBack: () => void }) {
  const running = a.status === 'running';
  const canStop = useCan('stopTask');
  const usage = a.info?.usage;
  const meta = [a.type, a.model, took(a, now), usage && tokens(usage.tokens), usage && plural(usage.toolUses, 'tool use'), a.info?.background && 'background'].filter(Boolean);
  return (
    <div className="ag-detail">
      <button className={`ag-back ${stack ? '' : 'mobile-only'}`} onClick={onBack}><Icon name="arrow-left" small /> Agents</button>
      <Section
        label={<><span className={`ag-mark ${a.status}`}><Icon name={STATUS_ICON[a.status]} small spin={running} /></span> <span title={a.description}>{a.description}</span></>}
        action={running && !a.group && canStop && <Button size="sm" icon="debug-stop" title="Stop this agent" onClick={() => send({ type: 'stop_task', toolUseId: a.id })}>Stop</Button>}
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
        {a.steps.length === 0 && <EmptyState size="sm" title="No steps yet" />}
        <div className="ag-steps-list">{a.steps.map((s) => <Row key={s.id} it={s} cwd={cwd} settled={!running} />)}</div>
      </section>
    </div>
  );
}
