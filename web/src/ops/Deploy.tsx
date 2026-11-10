import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, useStore } from '../app/store';
import { fetchJson } from '../app/api';
import { fetchDeployJob, fetchDeployStatus } from './opsApi';
import { Icon } from '../ui/Icon';
import { Button, IconButton } from '../ui/Button';
import { Menu, MenuItem } from '../ui/Menu';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { EmptyState } from '../ui/Panel';
import { Confirm, type ConfirmRequest } from '../ui/Confirm';
import type { DeployEnv, DeployJob, DeployStatus } from '../../../shared/protocol';
import { ago, usePoll, useSlot } from '../ui/util';
import '../styles/features/deploy.css';
import { Badge } from '../ui/Badge';
import { SetupButton } from './SetupButton';
import { createStore } from '../ui/createStore';
import '../styles/features/wiki.css';
import '../styles/features/meetings.css';

const short = (sha: string) => sha.slice(0, 7);
const pendingLatest = (env: DeployEnv) => {
  const l = env.latest;
  return l?.state && l.state !== 'inactive' && !(l.id === env.deployed?.id && l.state === 'success') ? l : null;
};
const stateBadge = (env: DeployEnv) => {
  const l = pendingLatest(env);
  if (!l) return null;
  return l.state === 'success' ? <Badge status="done" reason="Deployed" /> : l.state === 'failure' || l.state === 'error' ? <Badge status="failed" reason={l.description || undefined} /> : <Badge status="running" reason={l.description || 'Deploying'} />;
};

const jobs = createStore<Record<string, DeployJob | null>>({});
const setJob = (cwd: string, job: DeployJob | null) => jobs.set({ ...jobs.get(), [cwd]: job });
export const jobOf = (cwd: string) => jobs.get()[cwd] ?? null;
const useJob = (cwd: string) => jobs.use((j) => j[cwd] ?? null);

export function track(cwd: string, job: DeployJob, every = 3000) {
  setJob(cwd, job);
  if (job.done) return;
  setTimeout(() => {
    if (jobs.get()[cwd]?.id !== job.id) return;
    fetchDeployJob(job.id)
      .then((j) => track(cwd, j.error ? { ...job, done: true, lines: [...job.lines, j.error] } : j, every))
      .catch(() => track(cwd, job, every));
  }, every);
}

const post = (path: string, body: unknown) => fetchJson<DeployJob>(api(path), { method: 'POST', body: JSON.stringify(body) });

function EnvRow({ env, s, onDeploy, onRollback }: { env: DeployEnv; s: DeployStatus; onDeploy: (ref?: string) => void; onRollback: () => void }) {
  const [menu, setMenu] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const run = (f: () => void) => () => { setMenu(false); f(); };
  const d = env.deployed;
  const latest = pendingLatest(env);
  const meta = d ? `${d.ref || s.head.branch} · ${ago(d.at, ' ago')}${d.by ? ` by ${d.by}` : ''}${d.sha === s.head.sha ? ' · HEAD' : ''}` : 'Nothing deployed';
  return (
    <Row plain title={env.label} meta={meta} trailing={
      <>
        {stateBadge(env)}
        <Button size="sm" title={`Deploy ${short(s.head.sha)}`} onClick={() => onDeploy(s.head.sha)}>Deploy</Button>
        <span className="as-wrap-more">
          <IconButton ref={btn} icon="kebab-vertical" label="More" size="sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
          {menu && (
            <Menu trigger={btn} onClose={() => setMenu(false)}>
              <MenuItem onClick={run(() => onDeploy())}>Deploy a branch or commit…</MenuItem>
              {d && <MenuItem href={`https://github.com/${s.repo}/commit/${d.sha}`} onClick={() => setMenu(false)}>Open {short(d.sha)} on GitHub</MenuItem>}
              {latest?.url && <MenuItem href={latest.url} onClick={() => setMenu(false)}>Open the latest deploy</MenuItem>}
              <MenuItem disabled={!env.rollbackTo} title={env.rollbackTo ? undefined : 'No earlier deploy to roll back to'} onClick={run(onRollback)}>Roll back</MenuItem>
            </Menu>
          )}
        </span>
      </>
    } />
  );
}

function DeployLog({ job, close }: { job: DeployJob & { done: boolean }; close: () => void }) {
  return (
    <div className={`deploy-log ${job.done ? (job.ok ? 'ok' : 'bad') : ''}`}>
      <Section
        label={
          <>
            <Icon name={job.done ? (job.ok ? 'check' : 'error') : 'loading'} small spin={!job.done} />
            <span role="status">{job.done ? (job.ok ? 'Deployed' : 'Deploy did not succeed') : 'Deploying'}</span>
          </>
        }
        action={
          <>
            {job.url && <IconButton href={job.url} icon="link-external" label="Open in the deploy service" size="sm" small />}
            {job.done && <IconButton icon="close" label="Close" size="sm" small onClick={close} />}
          </>
        }
      />
      <pre className="mono">{job.lines.join('\n')}</pre>
    </div>
  );
}

export function Deploy() {
  const cwd = useStore((s) => s.session.cwd);
  const [status, setStatus] = useState<DeployStatus | null>(null);
  const [error, setError] = useState('');
  const [app, setApp] = useState('');
  const [loading, setLoading] = useState(false);
  const [appMenu, setAppMenu] = useState(false);
  const appBtn = useRef<HTMLButtonElement>(null);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const job = useJob(cwd);
  const root = useRef<HTMLDivElement>(null);
  const slot = useSlot('page-deploy-action');

  const seq = useRef(0);
  const load = () => {
    const n = ++seq.current;
    setLoading(true);
    fetchDeployStatus(app)
      .then((r) => n === seq.current && (r.error ? (setError(r.error), setStatus(null)) : (setError(''), setStatus(r))))
      .catch((e) => n === seq.current && setError(String(e)))
      .finally(() => n === seq.current && setLoading(false));
  };

  // Another repo has other apps; its status replaces this one's.
  useEffect(() => {
    setApp('');
    setStatus(null);
    setError('');
  }, [cwd]);

  useEffect(() => {
    if (cwd) load();
  }, [cwd, app, job?.done]);
  usePoll(root, 60_000, () => cwd && load(), [cwd, app]);

  const s = status;
  const refresh = <IconButton icon="refresh" label="Refresh" size="sm" spin={loading} onClick={load} />;
  const begin = (call: () => Promise<DeployJob>) => call().then((j) => track(cwd, j), (e: Error) => setJob(cwd, { id: '', lines: [e.message], done: true, ok: false, url: '' }));
  const warning = (env: DeployEnv) => (env.name.includes('prod') ? 'This is a production environment.' : env.defaultBranchOnly ? 'Only the default branch deploys here.' : undefined);

  const deploy = (env: DeployEnv, ref?: string) =>
    s && setAsk({
      title: `Deploy to ${env.label}?`,
      detail: ref ? `Deploys ${short(ref)} (HEAD of ${s.head.branch}) of ${s.app} to ${env.label} through the deploy service.` : `Branch or commit of ${s.app} to deploy to ${env.label} through the deploy service.`,
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
    <div className="wk" ref={root}><div className="wk-scroll"><div className="mt-page">
      <section>
      {slot && createPortal(refresh, slot)}
      {(s || !slot) && <Section label={s?.app ?? 'Deploy'} action={
        <>
          {s && s.apps.length > 1 && (
            <span className="as-wrap-more">
              <IconButton ref={appBtn} icon="arrow-swap" label="Switch app" size="sm" aria-haspopup="menu" aria-expanded={appMenu} onClick={() => setAppMenu(!appMenu)} />
              {appMenu && (
                <Menu trigger={appBtn} onClose={() => setAppMenu(false)}>
                  {s.apps.map((a) => <MenuItem key={a} icon={a === s.app ? 'check' : undefined} onClick={() => { setAppMenu(false); setApp(a); }}>{a}</MenuItem>)}
                </Menu>
              )}
            </span>
          )}
          {!slot && refresh}
        </>
      } />}
      {error && (error.includes('no deploy app')
        ? <EmptyState size="sm" icon="rocket" title="No deploy app here" hint="This repo has no .deploy/app.yaml" action={<SetupButton kind="deploy" />} />
        : <div className="deploy-error" role="alert"><Icon name="error" small /> {error}</div>)}
      {s && (
        <>
          <div className="as-group">
            {s.envs.map((env) => <EnvRow key={env.name} env={env} s={s} onDeploy={(ref) => deploy(env, ref)} onRollback={() => rollback(env)} />)}
          </div>
          <div className="as-group"><Row href={s.serviceUrl} title="Open in the deploy service" /></div>
        </>
      )}
      </section>
      {job && <DeployLog job={job} close={() => setJob(cwd, null)} />}
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </div></div></div>
  );
}
