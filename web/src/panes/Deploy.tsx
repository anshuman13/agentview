import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, useStore } from '../store';
import { Icon } from '../Icon';
import { Confirm, type ConfirmRequest } from '../Confirm';
import type { DeployEnv, DeployJob, DeployStatus } from '../../../shared/protocol';
import { ago, usePoll } from './util';
import '../styles/features/deploy.css';

const short = (sha: string) => sha.slice(0, 7);
const tone = (state?: string) => (state === 'success' ? 'ok' : state === 'failure' || state === 'error' ? 'bad' : !state || state === 'inactive' ? 'off' : 'busy');

let jobs: Record<string, DeployJob | null> = {};
const subs = new Set<() => void>();
const setJob = (cwd: string, job: DeployJob | null) => {
  jobs = { ...jobs, [cwd]: job };
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));
export const jobOf = (cwd: string) => jobs[cwd] ?? null;
const useJob = (cwd: string) => useSyncExternalStore(subscribe, jobOf.bind(null, cwd));

export function track(cwd: string, job: DeployJob, every = 3000) {
  setJob(cwd, job);
  if (job.done) return;
  setTimeout(() => {
    if (jobs[cwd]?.id !== job.id) return;
    fetch(api(`/api/deploy/job/${job.id}`))
      .then((r) => r.json())
      .then((j) => track(cwd, j.error ? { ...job, done: true, lines: [...job.lines, j.error] } : j, every))
      .catch(() => track(cwd, job, every));
  }, every);
}

async function post(path: string, body: unknown) {
  const r = await fetch(api(path), { method: 'POST', body: JSON.stringify(body) }).then((x) => x.json());
  if (r.error) throw new Error(r.error);
  return r as DeployJob;
}

export function Deploy() {
  const cwd = useStore((s) => s.session.cwd);
  const [status, setStatus] = useState<DeployStatus | null>(null);
  const [error, setError] = useState('');
  const [app, setApp] = useState('');
  const [loading, setLoading] = useState(false);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const job = useJob(cwd);
  const root = useRef<HTMLDivElement>(null);

  const load = () => {
    setLoading(true);
    fetch(api(`/api/deploy/status${app ? `?app=${encodeURIComponent(app)}` : ''}`))
      .then((r) => r.json())
      .then((r) => (r.error ? (setError(r.error), setStatus(null)) : (setError(''), setStatus(r))))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (cwd) load();
  }, [cwd, app, job?.done]);
  usePoll(root, 60_000, () => cwd && load(), [cwd, app]);

  const s = status;
  const begin = (call: () => Promise<DeployJob>) => call().then((j) => track(cwd, j), (e: Error) => setJob(cwd, { id: '', lines: [e.message], done: true, ok: false, url: '' }));
  const warning = (env: DeployEnv) => (env.name.includes('prod') ? 'This is a production environment.' : env.defaultBranchOnly ? 'Velodrome only deploys the default branch here.' : undefined);

  const deploy = (env: DeployEnv, ref?: string) =>
    s && setAsk({
      title: `Deploy to ${env.label}?`,
      detail: ref ? `Deploys ${short(ref)} (HEAD of ${s.head.branch}) of ${s.app} to ${env.label} through Velodrome.` : `Branch or commit of ${s.app} to deploy to ${env.label} through Velodrome.`,
      warning: warning(env),
      action: 'Deploy',
      icon: 'rocket',
      input: ref ? undefined : { value: s.head.branch, placeholder: 'Branch or commit' },
      run: (value) => begin(() => post('/api/deploy/run', { app: s.app, env: env.name, ref: ref ?? value })),
    });

  const rollback = (env: DeployEnv) =>
    s && env.deployed && env.rollbackTo && setAsk({
      title: `Roll back ${env.label}?`,
      detail: `Redeploys ${short(env.rollbackTo.sha)} (deployed ${ago(env.rollbackTo.at, ' ago')}) in place of ${short(env.deployed.sha)}.`,
      warning: warning(env),
      action: 'Roll back',
      icon: 'history',
      run: () => begin(() => post('/api/deploy/rollback', { app: s.app, env: env.name, sha: env.rollbackTo!.sha })),
    });

  return (
    <div className="deploy" ref={root}>
      <div className="deploy-head">
        {s && s.apps.length > 1 ? (
          <select className="deploy-app" value={s.app} onChange={(e) => setApp(e.target.value)}>
            {s.apps.map((a) => <option key={a}>{a}</option>)}
          </select>
        ) : (
          <span className="deploy-app">{s?.app ?? 'Velo'}</span>
        )}
        <span className="spacer" />
        <button className="icon-btn" title="Refresh" onClick={load}><Icon name={loading ? 'loading' : 'refresh'} small spin={loading} /></button>
      </div>
      {s && <a className="deploy-link" href={s.velodrome} target="_blank" rel="noreferrer"><Icon name="link-external" small /> Open in Velodrome</a>}
      {error && (error.includes('no Velo app')
        ? <div className="deploy-hint">No Velo app in this repo (no .deploy/app.yaml), so there is nothing to deploy from here.</div>
        : <div className="deploy-error"><Icon name="error" small /> {error}</div>)}
      {s?.envs.map((env) => (
        <div key={env.name} className="deploy-card">
          <div className="deploy-card-head">
            <span className={`deploy-dot ${tone(env.latest?.state)}`} title={env.latest?.state ?? 'Never deployed'} />
            <span className="deploy-env">{env.label}</span>
            <span className="spacer" />
            {env.latest && env.latest.id !== env.deployed?.id && <a className="chip" href={env.latest.url} target="_blank" rel="noreferrer">{env.latest.state}</a>}
          </div>
          {env.deployed ? (
            <div className="deploy-meta">
              <a className="mono" href={`https://github.com/${s.repo}/commit/${env.deployed.sha}`} target="_blank" rel="noreferrer">{short(env.deployed.sha)}</a>
              <span className="muted">{ago(env.deployed.at, ' ago')}{env.deployed.by && ` by ${env.deployed.by}`}</span>
              {env.deployed.sha === s.head.sha && <span className="chip">HEAD</span>}
            </div>
          ) : (
            <div className="deploy-meta muted">Nothing deployed</div>
          )}
          {env.latest?.description && tone(env.latest.state) !== 'ok' && <div className="deploy-meta muted">{env.latest.description}</div>}
          <div className="deploy-actions">
            <button onClick={() => deploy(env, s.head.sha)} title={`Deploy ${short(s.head.sha)}`}>Deploy HEAD</button>
            <button onClick={() => deploy(env)}>Deploy…</button>
            <button onClick={() => rollback(env)} disabled={!env.rollbackTo} title={env.rollbackTo ? `Redeploy ${short(env.rollbackTo.sha)}` : 'No earlier deploy to roll back to'}>Rollback</button>
          </div>
        </div>
      ))}
      {job && (
        <div className={`deploy-log ${job.done ? (job.ok ? 'ok' : 'bad') : ''}`}>
          <div className="deploy-log-head">
            <Icon name={job.done ? (job.ok ? 'check' : 'error') : 'loading'} small spin={!job.done} />
            <span>{job.done ? (job.ok ? 'Deployed' : 'Deploy did not succeed') : 'Deploying'}</span>
            <span className="spacer" />
            {job.url && <a href={job.url} target="_blank" rel="noreferrer">Velodrome</a>}
            {job.done && <button className="icon-btn" title="Close" onClick={() => setJob(cwd, null)}><Icon name="close" small /></button>}
          </div>
          <pre className="mono">{job.lines.join('\n')}</pre>
        </div>
      )}
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
