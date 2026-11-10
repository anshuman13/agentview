import { useRef, useState, type RefObject } from 'react';
import type { Job } from '../data/wiki/wiki';
import { Button, Chip, IconButton } from '../../ui/Button';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { nextRun } from '../../../../shared/schedule';
import { DAYS, DAY_NAMES, KINDS, type Kind, at, canRunNow, jobState, parseSchedule, removeJob, runNow, scheduleOf, useJobs } from './schedule';
import { Badge } from '../../ui/Badge';
import { useMcpHealth } from '../../ops/mcpShown';
import { scopeInfo, toggleConnector, toolId } from '../../ops/mcpHelpers';
import { useAssistantStore } from '../data';
import { useWorkspace } from '../../sessions/folders';

export function JobActions({ j, prompt, nameInput, back }: { j: Job; prompt: string; nameInput: RefObject<HTMLInputElement | null>; back: () => void }) {
  const store = useAssistantStore();
  const { runs, enable } = useJobs();
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const now = Date.now();
  const canRun = canRunNow({ ...j, prompt }, runs, now);
  const state = jobState(j, runs, now);
  const pick = (fn: () => void) => () => { setMenu(false); fn(); };
  const remove = () => {
    removeJob(store, j);
    back();
  };
  return (
    <span className="jb-actions">
      {state && <Badge {...state} />}
      <Button size="sm" variant="filled" icon="play" disabled={!canRun} onClick={() => runNow(store, j)}>Run now</Button>
      <span className="jb-more">
        <IconButton ref={more} size="sm" icon="kebab-horizontal" label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
        {menu && (
          <Menu trigger={more} onClose={() => setMenu(false)}>
            <MenuItem icon="edit" onClick={pick(() => { nameInput.current?.focus(); nameInput.current?.select(); })}>Edit</MenuItem>
            <MenuItem icon={j.enabled ? 'circle-slash' : 'play'} onClick={pick(() => enable(j, !j.enabled))}>{j.enabled ? 'Disable' : 'Enable'}</MenuItem>
            <MenuSeparator />
            <MenuItem icon="trash" danger onClick={pick(remove)}>Delete</MenuItem>
          </Menu>
        )}
      </span>
    </span>
  );
}

type WhenProps = { j: Job; custom: string; setCustom: (s: string) => void; customOk: boolean; saveCustom: () => void };

export function JobWhen({ j, custom, setCustom, customOk, saveCustom }: WhenProps) {
  const store = useAssistantStore();
  const sched = parseSchedule(j.schedule);
  const setSchedule = (p: Partial<typeof sched>) => {
    const n = { ...sched, ...p };
    // Custom starts from the current schedule, which the custom field reads too.
    if (n.kind !== 'custom') void store.editRow('jobs', j, { schedule: scheduleOf(n.kind, n.day, n.time), next_run_at: null });
    else if (sched.kind !== 'custom') void store.editRow('jobs', j, { schedule: `once ${new Date(Date.now() + 3_600_000).toLocaleDateString('sv')} ${n.time}`, next_run_at: null });
  };
  return (
    <section className="mt-sec">
      <h2>When</h2>
      <div className="jb-when">
        <select value={sched.kind} aria-label="How often" onChange={(e) => setSchedule({ kind: e.target.value as Kind })}>
          {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        {sched.kind === 'weekly' && (
          <select value={sched.day} aria-label="Day" onChange={(e) => setSchedule({ day: e.target.value })}>
            {[1, 2, 3, 4, 5, 6, 0].map((i) => <option key={i} value={DAYS[i]}>{DAY_NAMES[i].slice(0, -1)}</option>)}
          </select>
        )}
        {sched.kind === 'custom' && <input className="jb-custom" value={custom} aria-label="Custom schedule" aria-invalid={!customOk} placeholder="*/15 0-8 * * 1-5" onChange={(e) => setCustom(e.target.value)} onBlur={saveCustom} onKeyDown={(e) => e.key === 'Enter' && saveCustom()} />}
        {sched.kind !== 'hourly' && sched.kind !== 'custom' && <input type="time" value={sched.time} aria-label="Time" onChange={(e) => e.target.value && setSchedule({ time: e.target.value })} />}
      </div>
      {sched.kind === 'custom' && <div className="muted small">{customOk ? `Next ${at(nextRun(custom, Date.now())!)}. ` : 'This never runs. '}Use "once 2026-11-02 09:00" for one run, or a cron line: minute, hour, day, month, weekday.</div>}
    </section>
  );
}

export function JobTools({ j }: { j: Job }) {
  const store = useAssistantStore();
  const { servers } = useMcpHealth();
  const [adding, setAdding] = useState(false);
  const add = useRef<HTMLButtonElement>(null);
  const picked = (j.tools ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const toggle = (id: string) => void store.editRow('jobs', j, { tools: toggleConnector(j.tools ?? '', id) || null });
  const labelOf = (id: string) => (id === 'browser' ? 'Chrome' : servers.find((m) => toolId(m.name, '*') === id)?.name ?? id);
  return (
    <section className="mt-sec">
      <h2>Allowed tools</h2>
      <Button ref={add} size="sm" icon="plug" aria-haspopup="menu" aria-expanded={adding} onClick={() => setAdding(!adding)}>Add connector</Button>
      {adding && (
        <Menu trigger={add} onClose={() => setAdding(false)}>
          <MenuItem icon={picked.includes('browser') ? 'check' : undefined} onClick={() => { setAdding(false); toggle('browser'); }}>Chrome</MenuItem>
          {servers.map((m) => (
            <MenuItem key={m.name} icon={picked.includes(toolId(m.name, '*')) ? 'check' : undefined} onClick={() => { setAdding(false); toggle(toolId(m.name, '*')); }}>{m.name} · {scopeInfo(m.scope ?? 'other')[1]}</MenuItem>
          ))}
        </Menu>
      )}
      {picked.length > 0 && <div className="jb-tools">{picked.map((id) => <Chip key={id} size="sm" icon="close" aria-label={`Remove ${labelOf(id)}`} onClick={() => toggle(id)}>{labelOf(id)}</Chip>)}</div>}
      <div className="muted small">Connectors it may use beyond reading, with no one watching. Chrome is AgentView's own browser; a server lets it use every tool that server has.</div>
    </section>
  );
}

export const repoName = (repo: string) => repo.split('/').pop() || repo;

export function JobRepo({ j }: { j: Job }) {
  const store = useAssistantStore();
  const { folders } = useWorkspace(null);
  const [picking, setPicking] = useState(false);
  const pick = useRef<HTMLButtonElement>(null);
  const set = (repo: string | null) => {
    setPicking(false);
    void store.editRow('jobs', j, { repo });
  };
  return (
    <section className="mt-sec">
      <h2>Repo</h2>
      <Button ref={pick} size="sm" icon="repo" aria-haspopup="menu" aria-expanded={picking} onClick={() => setPicking(!picking)}>Pick repo</Button>
      {picking && (
        <Menu trigger={pick} onClose={() => setPicking(false)}>
          {folders.filter((f) => f.repo?.branch).map((f) => <MenuItem key={f.cwd} icon={f.cwd === j.repo ? 'check' : undefined} onClick={() => set(f.cwd)}>{f.name}</MenuItem>)}
          <MenuItem icon={j.repo ? undefined : 'check'} onClick={() => set(null)}>None</MenuItem>
        </Menu>
      )}
      {j.repo && <div className="jb-tools"><Chip size="sm" icon="close" aria-label={`Remove ${repoName(j.repo)}`} onClick={() => set(null)}>{repoName(j.repo)}</Chip></div>}
    </section>
  );
}
