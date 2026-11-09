import { useEffect, useState } from 'react';
import type { ObserveInfo, SnowflakeAuth, SnowflakeInfo, SnowflakeObjects, SnowflakeResult, SnowflakeTest } from '../../../shared/observe';
import { api } from '../app/store';
import { fetchJson } from '../app/api';
import { askChat } from '../ui/util';
import { Icon } from '../ui/Icon';
import { EmptyState } from '../ui/Panel';
import { errText } from '../../../shared/util';
import '../styles/features/observe.css';
import '../styles/features/wiki.css';
import '../styles/features/meetings.css';
import { AddToClaude, Err, type Load, Loading, Pane, bump, cell, post, track } from './observeShared';

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
        <option value="">{list.busy ? 'Loading…' : list.error ? 'Failed' : `${kind}${value ? '' : '…'}`}</option>
        {value && !list.data?.names.includes(value) && <option value={value}>{value}</option>}
        {list.data?.names.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      {list.error && <span className="error" title={list.error}><Icon name="warning" small /></span>}
    </div>
  );
}

type Conn = { sf: SnowflakeInfo; connected: boolean; missing: string[] };

function ConnectionForm({ sf, connected, missing, onInfo }: Conn & { onInfo: (i: ObserveInfo) => void }) {
  const [form, setForm] = useState<SnowflakeInfo & { secret: string }>({ ...sf, secret: '' });
  const [saveMsg, setSaveMsg] = useState('');
  const [test, setTest] = useState<Load<SnowflakeTest>>({ data: null, error: '', busy: false });
  const testConnection = () => track(setTest, () => post<SnowflakeTest>('/api/observe/snowflake/test', {}));

  useEffect(() => {
    setForm({ ...sf, secret: '' });
  }, [sf]);

  const saveForm = async () => {
    setSaveMsg('');
    try {
      const { hasSecret, ...rest } = form;
      onInfo(await post<ObserveInfo>('/api/observe/snowflake/config', { snowflake: rest }));
      setSaveMsg('Saved');
    } catch (e) {
      setSaveMsg(errText(e));
    }
  };

  const field = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <>
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
    </>
  );
}

function ResultTable({ data }: { data: SnowflakeResult }) {
  if (data.columns.length === 0) return <EmptyState size="sm" title="No rows" />;
  return (
    <div className="obs-table">
      <table>
        <thead><tr>{data.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={i}>{r.map((v, j) => <td key={j} title={cell(v)}>{cell(v)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QueryPanel({ sf, connected }: Pick<Conn, 'sf' | 'connected'>) {
  const [db, setDb] = useState(sf.database);
  const [schema, setSchema] = useState(sf.schema);
  const [table, setTable] = useState('');
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<Load<SnowflakeResult>>({ data: null, error: '', busy: false });

  useEffect(() => {
    setDb((d) => d || sf.database);
    setSchema((s) => s || sf.schema);
  }, [sf]);

  const run = () => {
    if (sql.trim()) track(setResult, () => post<SnowflakeResult>('/api/observe/snowflake/query', { sql }));
  };

  const pickTable = (t: string) => {
    setTable(t);
    if (t && db && schema) setSql(`SELECT * FROM ${db}.${schema}.${t} LIMIT 100`);
  };

  return (
    <>
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
        <button className="obs-ask" disabled={!connected} onClick={() => askChat(`Use the snowflake MCP${db ? ` on ${db}${schema ? `.${schema}` : ''}` : ''}: ${sql.trim() ? `run this query and explain the result:\n${sql.trim()}` : 'list the tables that matter for this service and describe what they hold'}`)}>
          <Icon name="sparkle" small /> Ask Claude
        </button>
      </div>
      <Err text={result.error} />
      {result.data && <ResultTable data={result.data} />}
    </>
  );
}

export function Snowflake({ info, onInfo }: { info: ObserveInfo; onInfo: (i: ObserveInfo) => void }) {
  const sf = info.snowflake;
  const connected = sf.hasSecret && !!sf.account && !!sf.user;
  const missing = [...(['account', 'user'] as const).filter((k) => !sf[k]), ...(sf.hasSecret ? [] : [sf.auth === 'pat' ? 'token' : 'password'])];
  return (
    <Pane
      label="Snowflake"
      open={false}
      action={<AddToClaude server="snowflake" added={info.inClaude.snowflake} disabled={!connected} title={connected ? 'Write the Snowflake MCP server into ~/.claude.json' : 'Save the connection first'} onDone={onInfo} />}
    >
      <ConnectionForm sf={sf} connected={connected} missing={missing} onInfo={onInfo} />
      <QueryPanel sf={sf} connected={connected} />
    </Pane>
  );
}
