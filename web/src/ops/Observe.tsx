import { useEffect, useRef, useState } from 'react';
import type { ObserveInfo } from '../../../shared/observe';
import type { Repo } from '../../../shared/protocol';
import { api, useStore } from '../app/store';
import { apiUrl, fetchJson } from '../app/api';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/Panel';
import { Section as UiSection } from '../ui/Section';
import { errText } from '../../../shared/util';
import '../styles/features/observe.css';
import { Badge, type BadgeSpec } from '../ui/Badge';
import '../styles/features/wiki.css';
import '../styles/features/meetings.css';
import { Grafana } from './Grafana';
import { Snowflake } from './Snowflake';
import { Err, Loading, post } from './observeShared';
import { SetupButton } from './SetupButton';

const SAVE_BADGE: Record<'unsaved' | 'saved' | 'failed', BadgeSpec> = { unsaved: { status: 'waiting', reason: 'Unsaved' }, saved: { status: 'done' }, failed: { status: 'failed' } };

type PickerProps = { input: string; setInput: (v: string) => void; names: string[]; commit: (v: string) => void; picked: string; reset: () => void };

function ProjectPicker({ input, setInput, names, commit, picked, reset }: PickerProps) {
  return (
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
          if (names.includes(e.target.value)) commit(e.target.value);
        }}
        onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && commit(input)}
        onBlur={() => commit(input)}
      />
      <datalist id="obs-repos">{names.map((n) => <option key={n} value={n} />)}</datalist>
      {picked && <button className="icon-btn" title="Back to this chat's repo" onClick={reset}><Icon name="discard" small /></button>}
    </div>
  );
}

type SettingsProps = { info: ObserveInfo; open: boolean; toggle: () => void; draft: string; saveState: 'idle' | 'unsaved' | 'saved' | 'failed'; saveError: string; saving: boolean; onEdit: (text: string) => void; onSave: () => void };

function SettingsSection({ info, open, toggle, draft, saveState, saveError, saving, onEdit, onSave }: SettingsProps) {
  return (
    <>
      <UiSection label="Settings" open={open} onToggle={toggle} action={saveState !== 'idle' && <Badge {...SAVE_BADGE[saveState]} />} />
      {open && (
        <div className="obs-body">
          <textarea className="obs-field" aria-label="Observe settings" value={draft} spellCheck={false} rows={14} onChange={(e) => onEdit(e.target.value)} />
          <Err text={saveError} />
          <div className="obs-hint">Grafana MCP: {info.grafanaServer ? `found in ${info.serversFile}` : `missing from ${info.serversFile}`}</div>
          <div className="obs-actions"><Button variant="primary" size="sm" disabled={saving} onClick={onSave}>Save</Button></div>
        </div>
      )}
    </>
  );
}

export function Observe() {
  const chat = useStore((s) => s.session.id);
  const [picked, setPicked] = useState('');
  const [input, setInput] = useState('');
  const [names, setNames] = useState<string[]>([]);
  const [info, setInfo] = useState<ObserveInfo | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const [saveState, setSaveState] = useState<'idle' | 'unsaved' | 'saved' | 'failed'>('idle');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    fetchJson<Repo[]>(apiUrl('/api/repos')).then((x) => setNames(x.map((r) => r.name)), () => {});
  }, []);

  useEffect(() => setPicked(''), [chat]);

  const show = (i: ObserveInfo) => {
    setInfo(i);
    setInput(i.repo);
    edit(JSON.stringify(i.config ?? i.guess, null, 2));
  };

  const edit = (text: string) => {
    draftRef.current = text;
    setDraft(text);
  };

  useEffect(() => {
    let live = true;
    setInfo(null);
    setError('');
    setSaveState('idle');
    setSaveError('');
    fetchJson<ObserveInfo>(api(`/api/observe${picked ? `?repo=${encodeURIComponent(picked)}` : ''}`)).then(
      (i) => {
        if (!live) return;
        show(i);
      }, (e) => live && setError(e.message),
    );
    return () => void (live = false);
  }, [picked, chat]);

  const commit = (v: string) => {
    const name = v.trim();
    if (name && name !== info?.repo) setPicked(name);
  };

  const saveConfig = async () => {
    if (!info) return;
    const sent = draft;
    setSaving(true);
    setSaveError('');
    try {
      const config = sent.trim() ? JSON.parse(sent) : null;
      const saved = await post<ObserveInfo>('/api/observe/config', { repo: info.repo, config });
      setInfo(saved);
      setInput(saved.repo);
      if (draftRef.current === sent) edit(JSON.stringify(saved.config ?? saved.guess, null, 2));
      setSaveState(draftRef.current === sent ? 'saved' : 'unsaved');
    } catch (e) {
      setSaveError(errText(e));
      setSaveState('failed');
    }
    setSaving(false);
  };

  const all = [...new Set([...names, ...(info?.repos ?? [])])].filter((n) => n !== 'example').sort();

  return (
    <div className="wk"><div className="wk-scroll"><div className="mt-page observe">
      <ProjectPicker input={input} setInput={setInput} names={all} commit={commit} picked={picked} reset={() => setPicked('')} />
      <Err text={error} />
      {!info && !error && <Loading />}
      {info && (
        <>
          {!info.config && (
            <EmptyState size="sm" icon="pulse" title={`No Grafana settings for ${info.repo}`} hint="The agent can find them and save the settings" action={<SetupButton kind="observe" repo={info.repo} />} />
          )}
          <Grafana key={`g-${info.repo}`} info={info} />
          <Snowflake info={info} onInfo={setInfo} />
          <SettingsSection info={info} open={settingsOpen} toggle={() => setSettingsOpen((v) => !v)} draft={draft} saveState={saveState} saveError={saveError} saving={saving} onEdit={(t) => { edit(t); setSaveState('unsaved'); setSaveError(''); }} onSave={saveConfig} />
        </>
      )}
    </div></div></div>
  );
}
