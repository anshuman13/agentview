import { useEffect, useMemo, useRef, useState } from 'react';
import { appSettings } from '../app/appSettings';
import { track } from '../app/featureUse';
import { notice, prompt, send, useStore } from '../app/store';
import { Button, Chip } from '../ui/Button';
import { Menu, MenuItem } from '../ui/Menu';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { Sheet } from '../ui/Sheet';
import { billing, providerLabel } from '../../../shared/providers';
import type { Provider } from '../../../shared/protocol';
import { goalCommand, parseEvery } from '../../../shared/goalForm';
import { ADVISOR_LOOP_CAP, ADVISOR_LOOP_EVERY, advisorLoopGoal, advisorOf } from '../../../shared/advisors';
import { planCondition } from '../../../shared/specTasks';
import { CAPS, EVERY, STOPS } from './goalLogic';
import { useWorkspace } from './folders';
import { askAdvisor } from './advisorChat';
import { useChatRun } from './runBands';
import { usePlanProgress } from './usePlanProgress';

export function GoalSheet({ plan, here, onClose }: { plan?: string; here?: boolean; onClose: () => void }) {
  const chat = useStore((s) => s.session.id);
  const cwd = useStore((s) => s.session.cwd);
  const chatProvider = useStore((s) => s.session.provider);
  const active = useChatRun(chat);
  const allProviders = appSettings.use((s) => s.providers);
  const providers = useMemo(() => allProviders.filter((p) => p.enabled), [allProviders]);
  const defaultProvider = appSettings.use((s) => s.defaultProvider);
  const { folders } = useWorkspace(null);
  const { markdown, progress, error } = usePlanProgress(plan ?? null);
  const [what, setWhat] = useState('');
  const [advisor, setAdvisor] = useState(false);
  const [every, setEvery] = useState(0);
  const [custom, setCustom] = useState('');
  const [stopIn, setStopIn] = useState<number | undefined>();
  const [stopAt, setStopAt] = useState<string | undefined>();
  const [capPct, setCapPct] = useState<number | null>(70);
  const [inHere, setInHere] = useState(false);
  const [dir, setDir] = useState(cwd);
  const [provider, setProvider] = useState<Provider>(defaultProvider);
  const [menu, setMenu] = useState(false);
  const [sent, setSent] = useState(false);
  const pick = useRef<HTMLSpanElement>(null);
  const opened = useRef(chat);
  const beforeLoop = useRef({ every, custom, stopIn, stopAt, capPct, inHere });
  useEffect(() => { if (chat !== opened.current) onClose(); }, [chat, onClose]);
  const loop = advisor && !plan;
  const canHere = Boolean(here && !active);
  const target = loop ? 'claude' : canHere && inHere ? chatProvider : provider;
  const dirs = folders.flatMap((f) => [{ cwd: f.cwd, name: f.name }, ...f.trees.map((w) => ({ cwd: w.cwd, name: w.name.split('/').pop()! }))]);
  if (cwd && !dirs.some((d) => d.cwd === cwd)) dirs.unshift({ cwd, name: cwd.split('/').pop() || cwd });
  const badEvery = Boolean(custom.trim()) && parseEvery(custom) === null;
  const ready = !badEvery && (!plan || (markdown !== null && !error));
  const root = (dir && !(loop && advisorOf(dir)) ? dir : '') || dirs.find((d) => !advisorOf(d.cwd))?.cwd;
  const condition = plan ? (markdown === null ? '' : planCondition(plan, markdown)) : loop ? (root ? advisorLoopGoal(root) : '') : what;
  const start = () => {
    track('action:startGoal');
    const text = goalCommand({ what: condition, every, stopIn: stopIn ?? null, stopAt: stopAt ?? null, capPct: billing(target) === 'none' ? null : capPct }, Date.now());
    if (loop) {
      askAdvisor('pm', text);
      onClose();
    } else if (canHere && inHere) {
      prompt(text, () => notice('Could not send the goal. Try again.'));
      onClose();
    } else {
      // The sheet closes when the new chat opens; a server error re-enables Start.
      setSent(true);
      setTimeout(() => setSent(false), 10_000);
      send({ type: 'new_session', cwd: root, provider, text });
    }
  };
  const pickLoop = () => {
    setAdvisor(!advisor);
    if (!advisor) {
      beforeLoop.current = { every, custom, stopIn, stopAt, capPct, inHere };
      setCustom(''); setEvery(ADVISOR_LOOP_EVERY); setStopIn(undefined); setStopAt(undefined); setCapPct(ADVISOR_LOOP_CAP); setInHere(false);
    } else {
      const b = beforeLoop.current;
      setWhat(''); setCustom(b.custom); setEvery(b.every); setStopIn(b.stopIn); setStopAt(b.stopAt); setCapPct(b.capPct); setInHere(b.inHere);
    }
  };
  const chips = (items: { label: string }[], on: (i: number) => boolean, set: (i: number) => void) =>
    <div className="gl-chips">{items.map((c, i) => <Chip key={c.label} on={on(i)} onClick={() => set(i)}>{c.label}</Chip>)}</div>;
  return (
    <Sheet label="New goal" onClose={onClose} className="gl-sheet">
      <Section label="What" />
      <div className="ui-group">
        {!plan && <div className="ui-fields"><div className="gl-chips"><Chip on={advisor} onClick={pickLoop}>Advisor loop</Chip></div></div>}
        {plan ? <Row plain title={plan} meta={error ? 'Could not read the plan. Check the file still exists.' : markdown === null ? undefined : progress ?? 'No tasks'} /> : (
          <div className="ui-fields"><textarea rows={3} aria-label="What is the goal?" placeholder="What is the goal?" value={condition} disabled={loop} onChange={(e) => setWhat(e.target.value)} /></div>
        )}
      </div>
      <Section label="How often" />
      <div className="ui-group">
        <div className="ui-fields">
          {chips(EVERY, (i) => !custom.trim() && EVERY[i].ms === every, (i) => { setCustom(''); setEvery(EVERY[i].ms); })}
          <input aria-label="Custom interval" placeholder="Custom, like 10m or 3h" value={custom} onChange={(e) => { setCustom(e.target.value); setEvery(parseEvery(e.target.value) ?? 0); }} />
          {badEvery && <div className="gl-note">Use minutes or hours from 10m to 168h, like 45m or 3h</div>}
        </div>
      </div>
      <Section label="Stop at" />
      <div className="ui-group">
        <div className="ui-fields">
          {chips(STOPS, (i) => STOPS[i].stopIn === stopIn && STOPS[i].stopAt === stopAt, (i) => { setStopIn(STOPS[i].stopIn); setStopAt(STOPS[i].stopAt); })}
          <input type="time" aria-label="Stop at" value={stopAt ?? ''} onChange={(e) => { setStopIn(undefined); setStopAt(e.target.value || undefined); }} />
        </div>
      </div>
      {billing(target) !== 'none' && (
        <>
          <Section label="Usage cap" />
          <div className="ui-group">
            <div className="ui-fields">
              {chips(CAPS, (i) => CAPS[i].pct === capPct, (i) => setCapPct(CAPS[i].pct))}
              <div className="gl-note">Skips rounds while the 5-hour window is over 90%</div>
            </div>
          </div>
        </>
      )}
      <Section label="Where" />
      <div className="ui-group">
        <div className="ui-fields">
          {canHere && !loop && chips([{ label: 'New chat' }, { label: 'This chat' }], (i) => (i === 1) === inHere, (i) => setInHere(i === 1))}
          {!(canHere && inHere) && (
            <>
              <select aria-label="Folder" disabled={Boolean(plan)} value={dir} onChange={(e) => setDir(e.target.value)}>
                {dirs.map((d) => <option key={d.cwd} value={d.cwd}>{d.name}</option>)}
              </select>
              {!loop && <span className="gl-anchor" ref={pick}>
                <Chip on aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>{providerLabel(provider)}</Chip>
                {menu && (
                  <Menu trigger={pick} onClose={() => setMenu(false)}>
                    {providers.map((p) => <MenuItem key={p.id} onClick={() => { setProvider(p.id); setMenu(false); }}>{p.label}</MenuItem>)}
                  </Menu>
                )}
              </span>}
            </>
          )}
        </div>
      </div>
      <div className="gl-actions"><Button variant="filled" size="lg" disabled={sent || !ready || !condition.trim()} onClick={start}>Start</Button></div>
    </Sheet>
  );
}
