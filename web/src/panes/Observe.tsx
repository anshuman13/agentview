import { useEffect, useState, type ReactNode } from 'react';
import type { ObserveInfo, SentryIssue } from '../../../shared/observe';
import type { Repo } from '../../../shared/protocol';
import { api, send, useStore } from '../store';
import { Icon } from '../Icon';
import './observe.css';

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const x = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || x?.error) throw new Error(x?.error ?? `HTTP ${r.status}`);
  return x;
}

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}

const QUICK: { label: string; icon: string; text: (sel: string, repo: string) => string }[] = [
  { label: 'Errors last 30 min', icon: 'error', text: (s) => `Use the grafana MCP: query Loki with ${s} |= "error" for the last 30 minutes, summarize the top error patterns with counts and one example line each` },
  { label: 'Logs last 15 min', icon: 'list-flat', text: (s) => `Use the grafana MCP: query Loki with ${s} for the last 15 minutes and summarize what the service is doing, with warnings and anything unusual` },
  { label: 'Slow requests', icon: 'watch', text: (s, r) => `Use the grafana MCP: find slow requests for ${r} in the last hour (find_slow_requests, or Loki ${s} duration fields), list the slowest endpoints with latency and counts` },
  { label: 'What changed in the last hour', icon: 'history', text: (s) => `Use the grafana MCP: compare Loki ${s} log volume and error patterns in the last hour with the hour before, and list what changed: new errors, spikes, deploys or restarts` },
];

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

export function Observe() {
  const chat = useStore((s) => s.session.id);
  const [picked, setPicked] = useState('');
  const [input, setInput] = useState('');
  const [names, setNames] = useState<string[]>([]);
  const [info, setInfo] = useState<ObserveInfo | null>(null);
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<SentryIssue[] | null>(null);
  const [sentryError, setSentryError] = useState('');
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

  const loadIssues = () => {
    if (!info) return;
    setIssues(null);
    setSentryError('');
    getJson<SentryIssue[]>(`/api/observe/sentry/issues?repo=${encodeURIComponent(info.repo)}`).then(setIssues, (e) => setSentryError(e.message));
  };
  useEffect(loadIssues, [info]);

  const commit = (v: string) => {
    const name = v.trim();
    if (name && name !== info?.repo) setPicked(name);
  };

  const saveConfig = async () => {
    if (!info) return;
    setSaveMsg('');
    try {
      const config = draft.trim() ? JSON.parse(draft) : null;
      show(await getJson<ObserveInfo>('/api/observe/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repo: info.repo, config }) }));
      setSaveMsg('Saved');
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const cfg = info ? info.config ?? info.guess : null;
  const selector = cfg?.grafana?.lokiSelector ?? '';
  const ask = (i: SentryIssue) =>
    send({
      type: 'prompt',
      text: `Investigate Sentry issue ${i.shortId} in ${info?.repo}: "${i.title}" at ${i.culprit || 'unknown location'}. ${i.count} events, ${i.userCount} users, last seen ${i.lastSeen}. Stack trace: ${i.permalink}. Open it in Chrome to read the stack trace and latest event, find the cause in the code and propose a fix.`,
    });
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
      {error && <div className="obs-hint error">{error}</div>}
      {!info && !error && <div className="obs-hint"><Icon name="loading" small spin /> Loading</div>}
      {info && (
        <div className="obs-scroll">
          {!info.config && (
            <div className="obs-hint setup">
              No Grafana or Sentry settings for <b>{info.repo}</b> yet. The settings below are a guess: check them and click Save. They live in {info.file}.
            </div>
          )}

          <Section title="Sentry: unresolved issues" actions={<button className="icon-btn" title="Refresh" onClick={loadIssues}><Icon name="refresh" small /></button>}>
            {sentryError && <div className="obs-hint error">{sentryError}</div>}
            {!issues && !sentryError && <div className="obs-hint"><Icon name="loading" small spin /> Loading</div>}
            {issues?.length === 0 && <div className="obs-hint">No unresolved issues</div>}
            {issues?.map((i) => (
              <div key={i.id} className={`obs-issue level-${i.level}`}>
                <div className="title" title={i.title}>{i.title}</div>
                {i.culprit && <div className="culprit" title={i.culprit}>{i.culprit}</div>}
                <div className="meta">
                  <span title="Events">{i.count} events</span>
                  <span title="Users">{i.userCount} users</span>
                  <span title={new Date(i.lastSeen).toLocaleString()}>{ago(i.lastSeen)} ago</span>
                  <span className="spacer" />
                  <a className="icon-btn" href={i.permalink} target="_blank" rel="noreferrer" title="Open in Sentry"><Icon name="link-external" small /></a>
                  <button className="obs-ask" onClick={() => ask(i)}><Icon name="sparkle" small /> Ask Claude</button>
                </div>
              </div>
            ))}
          </Section>

          <Section title="Grafana">
            {cfg?.grafana?.dashboards?.length ? (
              <div className="obs-chips">
                {cfg.grafana.dashboards.map((d) => (
                  <a key={d.url} className="obs-chip" href={d.url} target="_blank" rel="noreferrer" title={d.url}><Icon name="dashboard" small /> {d.title}</a>
                ))}
              </div>
            ) : (
              <div className="obs-hint">No dashboards. Add them under grafana.dashboards in the settings.</div>
            )}
            {cfg?.grafana?.url && <a className="obs-link" href={cfg.grafana.url} target="_blank" rel="noreferrer"><Icon name="link-external" small /> Open Grafana</a>}
            <div className="obs-quick">
              {QUICK.map((q) => (
                <button key={q.label} disabled={!selector} title={selector ? q.text(selector, info.repo) : 'Set grafana.lokiSelector first'} onClick={() => send({ type: 'prompt', text: q.text(selector, info.repo) })}>
                  <Icon name={q.icon} small /> {q.label}
                </button>
              ))}
            </div>
            {selector && <div className="obs-hint mono">{selector}</div>}
          </Section>

          <Section title="Settings" open={!info.config}>
            <textarea className="obs-editor" value={draft} spellCheck={false} rows={14} onChange={(e) => setDraft(e.target.value)} />
            <div className="obs-save">
              <button className="primary" onClick={saveConfig}>Save</button>
              {saveMsg && <span className={saveMsg === 'Saved' ? 'muted' : 'error'}>{saveMsg}</span>}
            </div>
            <div className="obs-hint">Sentry token: {info.sentryToken ? 'set' : `missing. Set SENTRY_AUTH_TOKEN or "sentryToken" in ${info.file}`}</div>
          </Section>
        </div>
      )}
    </div>
  );
}
