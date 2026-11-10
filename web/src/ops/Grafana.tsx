import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { GrafanaDashboards, GrafanaLogs, GrafanaPanel, GrafanaPanels, GrafanaPatterns, ObserveInfo } from '../../../shared/observe';
import { api } from '../app/store';
import { askChat, useSlot } from '../ui/util';
import { useCan } from '../chat/useCan';
import { Icon } from '../ui/Icon';
import { Button, IconButton } from '../ui/Button';
import { EmptyState } from '../ui/Panel';
import '../styles/features/observe.css';
import '../styles/features/wiki.css';
import '../styles/features/meetings.css';
import { Err, Loading, Pane, Sub, SubHead, useLoad } from './observeShared';

const clock = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const num = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString([], { maximumFractionDigits: 0 }) : String(Math.round(v * 100) / 100));

function PanelCard({ p }: { p: GrafanaPanel }) {
  const vs = p.points.map((x) => x[1]);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const W = 120;
  const H = 28;
  const path = p.points
    .map(([, v], i) => `${i ? 'L' : 'M'}${((i / Math.max(p.points.length - 1, 1)) * W).toFixed(1)},${(max === min ? H / 2 : H - 2 - ((v - min) / (max - min)) * (H - 4)).toFixed(1)}`)
    .join('');
  const title = p.error && !p.points.length ? `${p.title}\n${p.error}` : `${p.title}\nmin ${num(min)}${p.unit ?? ''}, max ${num(max)}${p.unit ?? ''} (6h)`;
  const body = (
    <>
      <span className="name">{p.title}</span>
      {p.last === null ? <span className="val error">{p.error ?? 'No data'}</span> : <span className="val">{num(p.last)}<span className="unit">{p.unit ?? ''}</span></span>}
      {p.points.length > 1 && <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true"><path d={path} /></svg>}
    </>
  );
  return p.link ? <a className="obs-panel" href={p.link} target="_blank" rel="noreferrer" title={title}>{body}</a> : <div className="obs-panel" title={title}>{body}</div>;
}

export function Grafana({ info }: { info: ObserveInfo }) {
  const canEdit = useCan('mcpEdit');
  const repo = encodeURIComponent(info.repo);
  const [dash, refreshDash] = useLoad<GrafanaDashboards>(info.grafanaServer ? `/api/observe/grafana/dashboards?repo=${repo}` : null);
  const [panels, refreshPanels] = useLoad<GrafanaPanels>(info.grafanaServer ? `/api/observe/grafana/panels?repo=${repo}` : null);
  const [logs, refreshLogs] = useLoad<GrafanaLogs>(info.grafanaServer ? `/api/observe/grafana/logs?repo=${repo}` : null);
  const [pats, refreshPats] = useLoad<GrafanaPatterns>(info.grafanaServer ? `/api/observe/grafana/patterns?repo=${repo}` : null);
  const cfg = info.config ?? info.guess;
  const selector = cfg.grafana?.lokiSelector ?? '';
  const refresh = () => {
    refreshDash();
    refreshPanels();
    refreshLogs();
    refreshPats();
  };
  const [question, setQuestion] = useState('');
  const prompt = (text: string) => () => askChat(`Use the grafana MCP for ${info.repo} (Loki selector ${selector}): ${text}`);
  const known = dash.data?.dashboards ?? cfg.grafana?.dashboards ?? [];
  const ask = () => {
    const q = question.trim();
    if (!q) return;
    const boards = known.length ? `\nDashboards for this service:\n${known.map((d) => `- ${d.title}: ${d.url}`).join('\n')}` : '';
    askChat(
      `Use the grafana MCP to answer a question about ${info.repo}. Its logs are in Loki under the selector ${selector || `{app="${info.repo}"}`}.${boards}\n\nQuestion: ${q}\n\nQuery the dashboards, Loki and Prometheus as needed. In the answer, link every Grafana dashboard you used and an Explore link (generate_deeplink) for each query you ran.`,
    );
    setQuestion('');
  };
  const slot = useSlot('page-observe-action');
  const refreshButton = <IconButton icon="refresh" label="Refresh" size="sm" small onClick={refresh} />;
  return (
    <>
    {slot && createPortal(refreshButton, slot)}
    <Pane label="Grafana" action={slot ? undefined : refreshButton}>
      {!info.grafanaServer && <EmptyState size="sm" title="No Grafana server" hint={canEdit ? 'Add one with: claude mcp add grafana -s user -e GRAFANA_URL=… -e GRAFANA_API_KEY=… -- mcp-grafana' : 'Add one with: codex mcp add grafana --env GRAFANA_URL=… --env GRAFANA_API_KEY=… -- mcp-grafana'} />}
      {info.grafanaServer && <>
      <form
        className="obs-askbar"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <input value={question} placeholder={`Ask about ${info.repo} in Grafana`} aria-label={`Ask about ${info.repo} in Grafana`} spellCheck={false} onChange={(e) => setQuestion(e.target.value)} />
        <button className="btn primary" disabled={!question.trim()}><Icon name="sparkle" small /> Ask</button>
      </form>
      <div className="obs-dashboards">
        {dash.data && dash.data.dashboards.length > 0 && (
          <div className="obs-chips">
            {dash.data.dashboards.map((d) => (
              <a key={d.url} className="obs-chip" href={d.url} target="_blank" rel="noreferrer" title={d.folder ? `${d.folder} / ${d.title}` : d.title}><Icon name="dashboard" small /> {d.title}</a>
            ))}
          </div>
        )}
        <SubHead
          label={dash.busy ? 'Looking for dashboards…' : `${dash.data?.dashboards.length ?? 0} dashboard${dash.data?.dashboards.length === 1 ? '' : 's'}`}
          link={dash.data?.link}
          linkLabel="Search in Grafana"
          ask={prompt('search the dashboards for this service, open the most relevant one and summarize what its panels show right now, with links')}
        />
        {dash.busy && <Loading />}
        <Err text={dash.error} />
        {dash.data?.dashboards.length === 0 && <EmptyState size="sm" title="No dashboards match" hint={`"${cfg.grafana?.query || info.repo}". Set grafana.query or grafana.dashboards in the settings`} />}
      </div>
      <Sub title="Metrics, last 6 hours">
        {panels.busy && <Loading />}
        <Err text={panels.error} />
        {panels.data && panels.data.panels.length > 0 && <div className="obs-panels">{panels.data.panels.map((p) => <PanelCard key={p.title} p={p} />)}</div>}
        {panels.data && panels.data.panels.length === 0 && (
          <EmptyState
            size="sm"
            title="No metric panels"
            action={<Button size="sm" icon="sparkle" onClick={prompt('look at this service\'s dashboards and suggest 3-4 PromQL panels (request rate, error rate, latency, saturation) as JSON for grafana.panels, an array of {"title","query","unit"}, and check that each query returns data')}>Suggest panels</Button>}
          />
        )}
      </Sub>
      <Sub title="Error logs, last hour" link={logs.data?.link} ask={prompt('query Loki for error lines in the last hour, group them and explain the top causes with one example line each')}>
        {logs.busy && <Loading />}
        <Err text={logs.error} />
        {logs.data && logs.data.logs.length === 0 && <EmptyState size="sm" title="No error lines" hint={`${logs.data.scanned} lines scanned in the last hour`} />}
        {logs.data && logs.data.logs.length > 0 && (
          <div className="obs-logs">
            {logs.data.logs.map((l, i) => (
              <div key={i} className={`line level-${l.level ?? ''}`} title={`${l.ts}\n${l.line}`}>
                <span className="ts">{clock(l.ts)}</span>
                <span className="text">{l.line}</span>
              </div>
            ))}
          </div>
        )}
      </Sub>
      <Sub title="Error patterns" link={pats.data?.link} ask={prompt('find the error patterns of the last hour (query_loki_patterns or find_error_pattern_logs, else group the error lines yourself), rank them by count and point at the code that logs each one')}>
        {pats.busy && <Loading />}
        <Err text={pats.error} />
        {pats.data && <div className="obs-hint">{pats.data.source}</div>}
        {pats.data && pats.data.patterns.length === 0 && <EmptyState size="sm" title="No error patterns" />}
        {pats.data && pats.data.patterns.length > 0 && (
          <div className="obs-patterns">
            {pats.data.patterns.map((p) => (
              <div key={p.pattern} className="pattern" title={p.pattern}>
                <span className="count">{p.count}</span>
                <span className="text">{p.pattern}</span>
              </div>
            ))}
          </div>
        )}
      </Sub>
      {selector && <div className="obs-hint mono">{selector}</div>}
      </>}
    </Pane>
    </>
  );
}

