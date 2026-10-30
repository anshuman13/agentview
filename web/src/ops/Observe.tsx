import { useEffect, useState, type ReactNode } from 'react';
import type {
  GrafanaDashboards,
  GrafanaLogs,
  GrafanaPatterns,
  ObserveInfo,
  SnowflakeAuth,
  SnowflakeInfo,
  SnowflakeObjects,
  SnowflakeResult,
  SnowflakeTest,
} from '../../../shared/observe';
import type { Repo } from '../../../shared/protocol';
import { api, useStore } from '../app/store';
import { apiUrl, fetchJson } from '../app/api';
import { askClaude, clickOnKey } from '../ui/util';
import { Icon } from '../ui/Icon';
import { message } from './pulls';
import '../styles/features/observe.css';

const post = <T,>(url: string, body: unknown) => fetchJson<T>(api(url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const clock = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

type Load<T> = { data: T | null; error: string; busy: boolean };

// The latest request per Load state; an older answer that lands later is dropped.
const latest = new WeakMap<object, number>();
const bump = (set: object) => {
  const n = (latest.get(set) ?? 0) + 1;
  latest.set(set, n);
  return n;
};

// Mirrors a request into a Load state: busy while it runs, then data or error.
function track<T>(set: (l: Load<T>) => void, request: () => Promise<T>) {
  const n = bump(set);
  set({ data: null, error: '', busy: true });
  request().then(
    (data) => latest.get(set) === n && set({ data, error: '', busy: false }),
    (e) => latest.get(set) === n && set({ data: null, error: message(e), busy: false }),
  );
}

function useLoad<T>(url: string | null): [Load<T>, () => void] {
  const [state, setState] = useState<Load<T>>({ data: null, error: '', busy: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let live = true;
    setState({ data: null, error: '', busy: true });
    fetchJson<T>(api(url)).then(
      (data) => live && setState({ data, error: '', busy: false }),
      (e) => live && setState({ data: null, error: e.message, busy: false }),
    );
    return () => {
      live = false;
    };
  }, [url, tick]);
  return [state, () => setTick((t) => t + 1)];
}

const Loading = () => <div className="obs-hint"><Icon name="loading" small spin /> Loading</div>;
const Err = ({ text }: { text: string }) => (text ? <div className="obs-hint error" role="alert">{text}</div> : null);

function Section({ title, children, actions, open: initial = true }: { title: string; children: ReactNode; actions?: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="obs-section">
      <div className="obs-head" onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} small />
        <span className="name" role="button" tabIndex={0} aria-expanded={open} onKeyDown={clickOnKey}>{title}</span>
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

function AddToClaude({ server, added, disabled, title, onDone }: { server: 'snowflake'; added: boolean; disabled?: boolean; title: string; onDone: (i: ObserveInfo) => void }) {
  const [msg, setMsg] = useState('');
  if (added) return <span className="chip st-ok" title={`${server} is in ~/.claude.json`}><Icon name="check" small /> In Claude</span>;
  return (
    <span className="obs-add">
      <button className="btn xs" disabled={disabled} title={title} onClick={() => post<{ info: ObserveInfo }>('/api/observe/mcp/add', { server }).then((r) => onDone(r.info), (e) => setMsg(e.message))}>
        <Icon name="add" small /> Add to Claude
      </button>
      {msg && <span className="error" role="alert">{msg}</span>}
    </span>
  );
}

function Grafana({ info }: { info: ObserveInfo }) {
  const repo = encodeURIComponent(info.repo);
  const [dash, refreshDash] = useLoad<GrafanaDashboards>(`/api/observe/grafana/dashboards?repo=${repo}`);
  const [logs, refreshLogs] = useLoad<GrafanaLogs>(`/api/observe/grafana/logs?repo=${repo}`);
  const [pats, refreshPats] = useLoad<GrafanaPatterns>(`/api/observe/grafana/patterns?repo=${repo}`);
  const cfg = info.config ?? info.guess;
  const selector = cfg.grafana?.lokiSelector ?? '';
  const refresh = () => {
    refreshDash();
    refreshLogs();
    refreshPats();
  };
  const [question, setQuestion] = useState('');
  const prompt = (text: string) => () => askClaude(`Use the grafana MCP for ${info.repo} (Loki selector ${selector}): ${text}`);
  const known = dash.data?.dashboards ?? cfg.grafana?.dashboards ?? [];
  const ask = () => {
    const q = question.trim();
    if (!q) return;
    const boards = known.length ? `\nDashboards for this service:\n${known.map((d) => `- ${d.title}: ${d.url}`).join('\n')}` : '';
    askClaude(
      `Use the grafana MCP to answer a question about ${info.repo}. Its logs are in Loki under the selector ${selector || `{app="${info.repo}"}`}.${boards}\n\nQuestion: ${q}\n\nQuery the dashboards, Loki and Prometheus as needed. In the answer, link every Grafana dashboard you used and an Explore link (generate_deeplink) for each query you ran.`,
    );
    setQuestion('');
  };
  return (
    <Section title="Grafana" actions={<button className="icon-btn" title="Refresh" onClick={refresh}><Icon name="refresh" small /></button>}>
      {!info.grafanaServer && <div className="obs-hint">No grafana MCP server in ~/.claude.json. Add one with: claude mcp add grafana -s user -e GRAFANA_URL=… -e GRAFANA_API_KEY=… -- mcp-grafana</div>}
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
        <div className="obs-subhead">
          <span className="name">{dash.busy ? 'Looking for dashboards' : `${dash.data?.dashboards.length ?? 0} dashboard${dash.data?.dashboards.length === 1 ? '' : 's'}`}</span>
          {dash.data?.link && <a className="obs-link" href={dash.data.link} target="_blank" rel="noreferrer"><Icon name="link-external" small /> Search in Grafana</a>}
          <button className="obs-ask" onClick={prompt('search the dashboards for this service, open the most relevant one and summarize what its panels show right now, with links')}><Icon name="sparkle" small /> Ask Claude</button>
        </div>
        {dash.busy && <Loading />}
        <Err text={dash.error} />
        {dash.data?.dashboards.length === 0 && <div className="obs-hint">No dashboards match "{cfg.grafana?.query || info.repo}". Set grafana.query or grafana.dashboards in the settings.</div>}
      </div>
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
      </>}
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
  const load = () => track(setList, () => fetchJson<SnowflakeObjects>(api(`/api/observe/snowflake/objects?kind=${kind}&${parent}`)));
  useEffect(() => {
    bump(setList);
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
  const [test, setTest] = useState<Load<SnowflakeTest>>({ data: null, error: '', busy: false });
  const connected = sf.hasSecret && !!sf.account && !!sf.user;
  const missing = [...(['account', 'user'] as const).filter((k) => !sf[k]), ...(sf.hasSecret ? [] : [sf.auth === 'pat' ? 'token' : 'password'])];

  const testConnection = () => track(setTest, () => post<SnowflakeTest>('/api/observe/snowflake/test', {}));

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
      setSaveMsg(message(e));
    }
  };

  const run = () => {
    if (sql.trim()) track(setResult, () => post<SnowflakeResult>('/api/observe/snowflake/query', { sql }));
  };

  const pickTable = (t: string) => {
    setTable(t);
    if (t && db && schema) setSql(`SELECT * FROM ${db}.${schema}.${t} LIMIT 100`);
  };

  const field = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Section
      title="Snowflake"
      open={false}
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
      <div className="obs-hint">
        Tokens: <a className="obs-link" href="https://docs.snowflake.com/en/user-guide/programmatic-access-tokens" target="_blank" rel="noreferrer">Snowflake docs on programmatic access tokens</a>
      </div>
      <div className="obs-save">
        <button className="btn primary" onClick={saveForm}>Save connection</button>
        <button className="btn xs" disabled={!connected || test.busy} title={connected ? 'select current_user(), current_role(), current_warehouse()' : `Missing: ${missing.join(', ')}`} onClick={testConnection}>{test.busy ? 'Testing' : 'Test connection'}</button>
        <span className={saveMsg && saveMsg !== 'Saved' ? 'error' : 'muted'}>{saveMsg || (connected ? `${sf.user} on ${sf.account}` : `missing: ${missing.join(', ')}`)}</span>
      </div>
      {test.data && (
        <div className="obs-hint ok">
          <Icon name="check" small /> {Object.entries(test.data.row).map(([k, v]) => `${k} ${cell(v) || 'none'}`).join(', ')} ({test.data.ms} ms)
        </div>
      )}
      <Err text={test.error} />
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
        aria-label="SQL query"
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
        <button className="btn primary" disabled={!connected || result.busy || !sql.trim()} onClick={run}><Icon name="play" small /> Run</button>
        {result.data && <span className="muted">{result.data.rows.length}{result.data.truncated ? '+' : ''} rows, {result.data.ms} ms{result.data.truncated ? ', showing the first 200' : ''}</span>}
        {result.busy && <span className="muted"><Icon name="loading" small spin /> Running</span>}
        <span className="spacer" />
        <button className="obs-ask" disabled={!connected} onClick={() => askClaude(`Use the snowflake MCP${db ? ` on ${db}${schema ? `.${schema}` : ''}` : ''}: ${sql.trim() ? `run this query and explain the result:\n${sql.trim()}` : 'list the tables that matter for this service and describe what they hold'}`)}>
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
    fetchJson<Repo[]>(apiUrl('/api/repos')).then((x) => setNames(x.map((r) => r.name)), () => {});
  }, []);

  useEffect(() => setPicked(''), [chat]);

  const show = (i: ObserveInfo) => {
    setInfo(i);
    setInput(i.repo);
    setDraft(JSON.stringify(i.config ?? i.guess, null, 2));
  };

  useEffect(() => {
    let live = true;
    setInfo(null);
    setError('');
    fetchJson<ObserveInfo>(api(`/api/observe${picked ? `?repo=${encodeURIComponent(picked)}` : ''}`)).then((i) => live && show(i), (e) => live && setError(e.message));
    return () => void (live = false);
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
      setSaveMsg(message(e));
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
          aria-label="Project"
          spellCheck={false}
          onChange={(e) => {
            setInput(e.target.value);
            if (all.includes(e.target.value)) commit(e.target.value);
          }}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && commit(input)}
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
              No Grafana settings for <b>{info.repo}</b> yet. The settings below are a guess: check them and click Save. They live in {info.file}.
            </div>
          )}
          <Grafana key={`g-${info.repo}`} info={info} />
          <Snowflake info={info} onInfo={setInfo} />
          <Section title="Settings" open={!info.config}>
            <textarea className="obs-editor" aria-label="Observe settings" value={draft} spellCheck={false} rows={14} onChange={(e) => setDraft(e.target.value)} />
            <div className="obs-save">
              <button className="btn primary" onClick={saveConfig}>Save</button>
              {saveMsg && <span className={saveMsg === 'Saved' ? 'muted' : 'error'}>{saveMsg}</span>}
            </div>
            <div className="obs-hint">Grafana MCP: {info.grafanaServer ? 'found in ~/.claude.json' : 'missing from ~/.claude.json'}</div>
          </Section>
        </div>
      )}
    </div>
  );
}
