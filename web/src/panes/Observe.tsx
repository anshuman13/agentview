import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type {
  GrafanaDashboards,
  GrafanaLogs,
  GrafanaPatterns,
  ObserveInfo,
  SentryDetails,
  SentryIssue,
  SentryIssues,
  SnowflakeAuth,
  SnowflakeInfo,
  SnowflakeObjects,
  SnowflakeResult,
} from '../../../shared/observe';
import type { Repo } from '../../../shared/protocol';
import { api, send, useStore } from '../store';
import { Icon } from '../Icon';
import '../observe.css';

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const x = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || x?.error) throw new Error(x?.error ?? `HTTP ${r.status}`);
  return x;
}

const post = <T,>(url: string, body: unknown) => getJson<T>(api(url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function ago(iso: string) {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t)) return iso || '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return `${m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`} ago`;
}

const clock = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

type Load<T> = { data: T | null; error: string; busy: boolean };

function useLoad<T>(url: string | null, deps: unknown[]): [Load<T>, () => void] {
  const [state, setState] = useState<Load<T>>({ data: null, error: '', busy: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let live = true;
    setState({ data: null, error: '', busy: true });
    getJson<T>(api(url)).then(
      (data) => live && setState({ data, error: '', busy: false }),
      (e) => live && setState({ data: null, error: e.message, busy: false }),
    );
    return () => {
      live = false;
    };
  }, [url, tick, ...deps]);
  return [state, () => setTick((t) => t + 1)];
}

const Loading = () => <div className="obs-hint"><Icon name="loading" small spin /> Loading</div>;
const Err = ({ text }: { text: string }) => (text ? <div className="obs-hint error">{text}</div> : null);

function Section({ title, children, actions, open: initial = true }: { title: string; children: ReactNode; actions?: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="obs-section">
      <div className="obs-head" onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} small />
        <span className="name">{title}</span>
        <span className="acts" onClick={(e) => e.stopPropagation()}>{actions}</span>
      </div>
      {open && <div className="obs-body">{children}</div>}
    </div>
  );
}

function Sub({ title, link, ask, children }: { title: string; link?: string; ask?: () => void; children: ReactNode }) {
  return (
    <div className="obs-sub">
      <div className="obs-subhead">
        <span className="name">{title}</span>
        {link && <a className="obs-link" href={link} target="_blank" rel="noreferrer"><Icon name="link-external" small /> Open in Grafana</a>}
        {ask && <button className="obs-ask" onClick={ask}><Icon name="sparkle" small /> Ask Claude</button>}
      </div>
      {children}
    </div>
  );
}

function AddToClaude({ server, added, disabled, title, onDone }: { server: 'sentry' | 'snowflake'; added: boolean; disabled?: boolean; title: string; onDone: (i: ObserveInfo) => void }) {
  const [msg, setMsg] = useState('');
  if (added) return <span className="obs-tag ok" title={`${server} is in ~/.claude.json`}><Icon name="check" small /> In Claude</span>;
  return (
    <span className="obs-add">
      <button disabled={disabled} title={title} onClick={() => post<{ info: ObserveInfo; backup: string }>('/api/observe/mcp/add', { server }).then((r) => onDone(r.info), (e) => setMsg(e.message))}>
        <Icon name="add" small /> Add to Claude
      </button>
      {msg && <span className="error">{msg}</span>}
    </span>
  );
}

function Issue({ issue, repo }: { issue: SentryIssue; repo: string }) {
  const [open, setOpen] = useState(false);
  const [details, refresh] = useLoad<SentryDetails>(open ? `/api/observe/sentry/issue?repo=${encodeURIComponent(repo)}&id=${encodeURIComponent(issue.id)}&shortId=${encodeURIComponent(issue.shortId)}` : null, []);
  const ask = () =>
    send({
      type: 'prompt',
      text: `Investigate Sentry issue ${issue.shortId} (id ${issue.id}) in ${repo}: "${issue.title}" at ${issue.culprit || 'unknown location'}. ${issue.count} events, ${issue.userCount} users, last seen ${issue.lastSeen}. Use the Sentry MCP (get_sentry_resource with resourceType issue and resourceId ${issue.shortId}, or the URL ${issue.permalink}) to read the latest event and stack trace, find the cause in the code and propose a fix.`,
    });
  return (
    <div className={`obs-issue level-${issue.level || 'none'}`}>
      <div className="row">
        <span className="dot" title={issue.level || 'unknown level'} />
        <span className="title" title={issue.title}>{issue.title}</span>
      </div>
      {issue.culprit && <div className="culprit" title={issue.culprit}>{issue.culprit}</div>}
      <div className="meta">
        <span title="Events">{issue.count} events</span>
        {issue.userCount > 0 && <span title="Users">{issue.userCount} users</span>}
        <span title={issue.lastSeen}>{ago(issue.lastSeen)}</span>
        <span className="spacer" />
        <button className="obs-mini" onClick={() => setOpen((v) => !v)}>{open ? 'Hide' : 'Details'}</button>
        <a className="icon-btn" href={issue.permalink} target="_blank" rel="noreferrer" title="Open in Sentry"><Icon name="link-external" small /></a>
        <button className="obs-ask" onClick={ask}><Icon name="sparkle" small /> Ask Claude</button>
      </div>
      {open && (
        <div className="obs-details">
          {details.busy && <Loading />}
          <Err text={details.error} />
          {details.error && <button className="obs-mini" onClick={refresh}>Retry</button>}
          {details.data && (
            <>
              <div className="obs-hint">via {details.data.via === 'mcp' ? 'Sentry MCP' : 'Sentry REST API'}</div>
              <pre className="obs-mono">{details.data.text || 'No stack trace in the latest event'}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Sentry({ info, onInfo }: { info: ObserveInfo; onInfo: (i: ObserveInfo) => void }) {
  const [issues, refresh] = useLoad<SentryIssues>(`/api/observe/sentry/issues?repo=${encodeURIComponent(info.repo)}`, []);
  const path = info.sentryServer === 'config' ? 'Sentry MCP from your Claude config' : info.sentryServer === 'npx' ? 'Sentry MCP (npx @sentry/mcp-server) with your token' : 'no Sentry MCP server and no token';
  return (
    <Section
      title="Sentry: unresolved issues"
      actions={
        <>
          <AddToClaude server="sentry" added={info.inClaude.sentry} disabled={!info.sentryToken} title={info.sentryToken ? 'Write the Sentry MCP server into ~/.claude.json' : 'Set sentryToken in the settings first'} onDone={onInfo} />
          <button className="icon-btn" title="Refresh" onClick={refresh}><Icon name="refresh" small /></button>
        </>
      }
    >
      <div className="obs-hint" title={path}>
        {issues.data ? `via ${issues.data.via === 'mcp' ? 'Sentry MCP' : 'Sentry REST API'}` : path}
      </div>
      {issues.data?.note && <div className="obs-hint warn">{issues.data.note}</div>}
      {issues.busy && <Loading />}
      <Err text={issues.error} />
      {issues.data?.issues.length === 0 && <div className="obs-hint">No unresolved issues</div>}
      {issues.data?.issues.map((i) => <Issue key={i.id} issue={i} repo={info.repo} />)}
    </Section>
  );
}

function Grafana({ info }: { info: ObserveInfo }) {
  const repo = encodeURIComponent(info.repo);
  const [dash, refreshDash] = useLoad<GrafanaDashboards>(`/api/observe/grafana/dashboards?repo=${repo}`, []);
  const [logs, refreshLogs] = useLoad<GrafanaLogs>(`/api/observe/grafana/logs?repo=${repo}`, []);
  const [pats, refreshPats] = useLoad<GrafanaPatterns>(`/api/observe/grafana/patterns?repo=${repo}`, []);
  const cfg = info.config ?? info.guess;
  const selector = cfg.grafana?.lokiSelector ?? '';
  const refresh = () => {
    refreshDash();
    refreshLogs();
    refreshPats();
  };
  const prompt = (text: string) => () => send({ type: 'prompt', text: `Use the grafana MCP for ${info.repo} (Loki selector ${selector}): ${text}` });
  return (
    <Section title="Grafana" actions={<button className="icon-btn" title="Refresh" onClick={refresh}><Icon name="refresh" small /></button>}>
      {!info.grafanaServer && <div className="obs-hint error">No grafana MCP server in ~/.claude.json</div>}
      <Sub title="Dashboards" link={dash.data?.link} ask={prompt('search the dashboards for this service, open the most relevant one and summarize what its panels show right now')}>
        {dash.busy && <Loading />}
        <Err text={dash.error} />
        {dash.data?.dashboards.length === 0 && <div className="obs-hint">No dashboards match "{cfg.grafana?.query || info.repo}". Set grafana.query or grafana.dashboards in the settings.</div>}
        {dash.data && dash.data.dashboards.length > 0 && (
          <div className="obs-chips">
            {dash.data.dashboards.map((d) => (
              <a key={d.url} className="obs-chip" href={d.url} target="_blank" rel="noreferrer" title={d.folder ? `${d.folder} / ${d.title}` : d.title}><Icon name="dashboard" small /> {d.title}</a>
            ))}
          </div>
        )}
      </Sub>
      <Sub title="Error logs, last hour" link={logs.data?.link} ask={prompt('query Loki for error lines in the last hour, group them and explain the top causes with one example line each')}>
        {logs.busy && <Loading />}
        <Err text={logs.error} />
        {logs.data && logs.data.logs.length === 0 && <div className="obs-hint">No error lines in the last hour ({logs.data.scanned} lines scanned)</div>}
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
        {pats.data && pats.data.patterns.length === 0 && <div className="obs-hint">No error patterns</div>}
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
    </Section>
  );
}

const FIELDS: { key: keyof Omit<SnowflakeInfo, 'auth' | 'hasSecret'>; label: string; hint: string }[] = [
  { key: 'account', label: 'Account', hint: 'orgname-accountname' },
  { key: 'user', label: 'User', hint: 'login name' },
  { key: 'warehouse', label: 'Warehouse', hint: 'optional' },
  { key: 'role', label: 'Role', hint: 'optional' },
  { key: 'database', label: 'Database', hint: 'default for the picker' },
  { key: 'schema', label: 'Schema', hint: 'default for the picker' },
];

function Picker({ kind, parent, value, onPick, enabled }: { kind: 'database' | 'schema' | 'table'; parent: string; value: string; onPick: (v: string) => void; enabled: boolean }) {
  const [list, setList] = useState<Load<SnowflakeObjects>>({ data: null, error: '', busy: false });
  const load = () => {
    setList({ data: null, error: '', busy: true });
    getJson<SnowflakeObjects>(api(`/api/observe/snowflake/objects?kind=${kind}&${parent}`)).then(
      (data) => setList({ data, error: '', busy: false }),
      (e) => setList({ data: null, error: e.message, busy: false }),
    );
  };
  useEffect(() => {
    setList({ data: null, error: '', busy: false });
  }, [parent]);
  return (
    <div className="obs-pick">
      <select value={value} disabled={!enabled} onFocus={() => !list.data && !list.busy && enabled && load()} onChange={(e) => onPick(e.target.value)} title={list.error || kind}>
        <option value="">{list.busy ? 'Loading' : list.error ? 'Failed' : `${kind}${value ? '' : '...'}`}</option>
        {value && !list.data?.names.includes(value) && <option value={value}>{value}</option>}
        {list.data?.names.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      {list.error && <span className="error" title={list.error}><Icon name="warning" small /></span>}
    </div>
  );
}

function Snowflake({ info, onInfo }: { info: ObserveInfo; onInfo: (i: ObserveInfo) => void }) {
  const sf = info.snowflake;
  const [form, setForm] = useState<SnowflakeInfo & { secret: string }>({ ...sf, secret: '' });
  const [saveMsg, setSaveMsg] = useState('');
  const [db, setDb] = useState(sf.database);
  const [schema, setSchema] = useState(sf.schema);
  const [table, setTable] = useState('');
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<Load<SnowflakeResult>>({ data: null, error: '', busy: false });
  const connected = sf.hasSecret && !!sf.account && !!sf.user;

  useEffect(() => {
    setForm({ ...sf, secret: '' });
    setDb((d) => d || sf.database);
    setSchema((s) => s || sf.schema);
  }, [sf]);

  const saveForm = async () => {
    setSaveMsg('');
    try {
      const { hasSecret, ...rest } = form;
      onInfo(await post<ObserveInfo>('/api/observe/snowflake/config', { snowflake: rest }));
      setSaveMsg('Saved');
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const run = useCallback(() => {
    if (!sql.trim()) return;
    setResult({ data: null, error: '', busy: true });
    post<SnowflakeResult>('/api/observe/snowflake/query', { sql }).then(
      (data) => setResult({ data, error: '', busy: false }),
      (e) => setResult({ data: null, error: e.message, busy: false }),
    );
  }, [sql]);

  const pickTable = (t: string) => {
    setTable(t);
    if (t && db && schema) setSql(`SELECT * FROM ${db}.${schema}.${t} LIMIT 100`);
  };

  const field = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Section
      title="Snowflake"
      open={connected}
      actions={<AddToClaude server="snowflake" added={info.inClaude.snowflake} disabled={!connected} title={connected ? 'Write the Snowflake MCP server into ~/.claude.json' : 'Save the connection first'} onDone={onInfo} />}
    >
      <div className="obs-form">
        {FIELDS.map((f) => (
          <label key={f.key}>
            <span>{f.label}</span>
            <input value={form[f.key]} placeholder={f.hint} spellCheck={false} onChange={(e) => field(f.key, e.target.value)} />
          </label>
        ))}
        <label>
          <span>Auth</span>
          <select value={form.auth} onChange={(e) => field('auth', e.target.value as SnowflakeAuth)}>
            <option value="pat">Programmatic access token</option>
            <option value="password">Password</option>
          </select>
        </label>
        <label>
          <span>{form.auth === 'pat' ? 'Token' : 'Password'}</span>
          <input type="password" value={form.secret} placeholder={sf.hasSecret ? 'saved, leave empty to keep' : 'required'} autoComplete="off" onChange={(e) => field('secret', e.target.value)} />
        </label>
      </div>
      <div className="obs-save">
        <button className="primary" onClick={saveForm}>Save connection</button>
        <span className={saveMsg && saveMsg !== 'Saved' ? 'error' : 'muted'}>{saveMsg || (connected ? `connected as ${sf.user} on ${sf.account}` : 'not connected')}</span>
      </div>
      <div className="obs-pickers">
        <Picker kind="database" parent="" value={db} enabled={connected} onPick={(v) => { setDb(v); setSchema(''); setTable(''); }} />
        <Picker kind="schema" parent={`database=${encodeURIComponent(db)}`} value={schema} enabled={connected && !!db} onPick={(v) => { setSchema(v); setTable(''); }} />
        <Picker kind="table" parent={`database=${encodeURIComponent(db)}&schema=${encodeURIComponent(schema)}`} value={table} enabled={connected && !!db && !!schema} onPick={pickTable} />
      </div>
      <textarea
        className="obs-editor sql"
        value={sql}
        rows={4}
        spellCheck={false}
        placeholder={connected ? 'SELECT ... (Cmd+Enter runs; SELECT, SHOW, DESCRIBE and WITH only)' : 'Save a connection to run queries'}
        disabled={!connected}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            run();
          }
        }}
      />
      <div className="obs-save">
        <button className="primary" disabled={!connected || result.busy || !sql.trim()} onClick={run}><Icon name="play" small /> Run</button>
        {result.data && <span className="muted">{result.data.rows.length}{result.data.truncated ? '+' : ''} rows, {result.data.ms} ms{result.data.truncated ? ', showing the first 200' : ''}</span>}
        {result.busy && <span className="muted"><Icon name="loading" small spin /> Running</span>}
        <span className="spacer" />
        <button className="obs-ask" disabled={!connected} onClick={() => send({ type: 'prompt', text: `Use the snowflake MCP${db ? ` on ${db}${schema ? `.${schema}` : ''}` : ''}: ${sql.trim() ? `run this query and explain the result:\n${sql.trim()}` : 'list the tables that matter for this service and describe what they hold'}` })}>
          <Icon name="sparkle" small /> Ask Claude
        </button>
      </div>
      <Err text={result.error} />
      {result.data && result.data.columns.length > 0 && (
        <div className="obs-table">
          <table>
            <thead><tr>{result.data.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {result.data.rows.map((r, i) => (
                <tr key={i}>{r.map((v, j) => <td key={j} title={cell(v)}>{cell(v)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.data && result.data.columns.length === 0 && <div className="obs-hint">No rows</div>}
    </Section>
  );
}

const cell = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function Observe() {
  const chat = useStore((s) => s.session.id);
  const [picked, setPicked] = useState('');
  const [input, setInput] = useState('');
  const [names, setNames] = useState<string[]>([]);
  const [info, setInfo] = useState<ObserveInfo | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    getJson<Repo[]>('/api/repos').then((x) => setNames(x.map((r) => r.name)), () => {});
  }, []);

  useEffect(() => setPicked(''), [chat]);

  const show = (i: ObserveInfo) => {
    setInfo(i);
    setInput(i.repo);
    setDraft(JSON.stringify(i.config ?? i.guess, null, 2));
  };

  useEffect(() => {
    setInfo(null);
    setError('');
    getJson<ObserveInfo>(api(`/api/observe${picked ? `?repo=${encodeURIComponent(picked)}` : ''}`)).then(show, (e) => setError(e.message));
  }, [picked, chat]);

  const commit = (v: string) => {
    const name = v.trim();
    if (name && name !== info?.repo) setPicked(name);
  };

  const saveConfig = async () => {
    if (!info) return;
    setSaveMsg('');
    try {
      const config = draft.trim() ? JSON.parse(draft) : null;
      show(await post<ObserveInfo>('/api/observe/config', { repo: info.repo, config }));
      setSaveMsg('Saved');
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const all = [...new Set([...names, ...(info?.repos ?? [])])].filter((n) => n !== 'example').sort();

  return (
    <div className="observe">
      <div className="obs-picker">
        <Icon name="repo" small />
        <input
          list="obs-repos"
          value={input}
          placeholder="Project"
          spellCheck={false}
          onChange={(e) => {
            setInput(e.target.value);
            if (all.includes(e.target.value)) commit(e.target.value);
          }}
          onKeyDown={(e) => e.key === 'Enter' && commit(input)}
          onBlur={() => commit(input)}
        />
        <datalist id="obs-repos">{all.map((n) => <option key={n} value={n} />)}</datalist>
        {picked && <button className="icon-btn" title="Back to this chat's repo" onClick={() => setPicked('')}><Icon name="discard" small /></button>}
      </div>
      <Err text={error} />
      {!info && !error && <Loading />}
      {info && (
        <div className="obs-scroll">
          {!info.config && (
            <div className="obs-hint setup">
              No Grafana or Sentry settings for <b>{info.repo}</b> yet. The settings below are a guess: check them and click Save. They live in {info.file}.
            </div>
          )}
          <Sentry key={`s-${info.repo}`} info={info} onInfo={setInfo} />
          <Grafana key={`g-${info.repo}`} info={info} />
          <Snowflake info={info} onInfo={setInfo} />
          <Section title="Settings" open={!info.config}>
            <textarea className="obs-editor" value={draft} spellCheck={false} rows={14} onChange={(e) => setDraft(e.target.value)} />
            <div className="obs-save">
              <button className="primary" onClick={saveConfig}>Save</button>
              {saveMsg && <span className={saveMsg === 'Saved' ? 'muted' : 'error'}>{saveMsg}</span>}
            </div>
            <div className="obs-hint">Sentry token: {info.sentryToken ? 'set' : `missing. Set SENTRY_AUTH_TOKEN or "sentryToken" in ${info.file}`}</div>
            <div className="obs-hint">Grafana MCP: {info.grafanaServer ? 'found in ~/.claude.json' : 'missing from ~/.claude.json'}</div>
          </Section>
        </div>
      )}
    </div>
  );
}
