import { useMemo, useState } from 'react';
import { appSettings } from '../app/appSettings';
import { knownModels, recentInRepo, startChat, startModel, startProvider } from '../app/newChat';
import { useStore } from '../app/store';
import { Button, Chip } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { Sheet } from '../ui/Sheet';
import { START_MODES, checkedModel, newestModels } from '../../../shared/providers';
import type { Provider } from '../../../shared/protocol';
import { UNTITLED } from '../../../shared/util';
import { dirChoices, since, useWorkspace } from './folders';
import { openChat } from './goalLogic';

// The sheet behind the new chat buttons (Android NewChatSheet): the repo when none is given (the open chat's first), and the model, which starts on the last one used, else the provider's default (its first model, which the chat gets when none is sent).
export function NewChatSheet({ repo: fixed, onClose }: { repo?: string; onClose: () => void }) {
  const cwd = useStore((s) => s.session.cwd);
  const live = useStore((s) => s.live);
  const providers = appSettings.use((s) => s.providers);
  const defaultProvider = appSettings.use((s) => s.defaultProvider);
  const { folders, chats } = useWorkspace(null);
  const dirs = useMemo(() => dirChoices(folders, cwd), [folders, cwd]);
  const [start, setStart] = useState(START_MODES[0]);
  const [provider, setProvider] = useState<Provider>(() => startProvider(defaultProvider, providers));
  const [model, setModel] = useState(() => startModel(provider));
  const [picked, setPicked] = useState<string>();
  const repo = fixed ?? picked ?? dirs[0]?.cwd;
  const models = newestModels(knownModels(provider), model);
  const checked = checkedModel(models, model);
  const recent = recentInRepo(chats, live.map((c) => c.sessionId), repo);
  const go = () => {
    startChat({ cwd: repo, provider, ...(model && { model }) }, start);
    onClose();
  };
  const resume = (sessionId: string) => {
    openChat({ sessionId });
    onClose();
  };
  return (
    <Sheet label="New chat" onClose={onClose} className="gl-sheet">
      <Section label="Start as" />
      <div className="ui-group">
        <div className="ui-fields">
          <div className="gl-chips">{START_MODES.map((m) => <Chip key={m.label} on={m === start} onClick={() => setStart(m)}>{m.label}</Chip>)}</div>
        </div>
      </div>
      {providers.filter((p) => p.enabled).length > 1 && (
        <>
          <Section label="Provider" />
          <div className="ui-group">
            <div className="ui-fields">
              <div className="gl-chips">
                {providers.map((p) => <Chip key={p.id} on={p.id === provider} disabled={!p.enabled} onClick={() => { setProvider(p.id); setModel(startModel(p.id)); }}>{p.label}</Chip>)}
              </div>
              {providers.filter((p) => !p.enabled && p.note).map((p) => <div key={p.id} className="gl-note">{`${p.label}: ${p.note}`}</div>)}
            </div>
          </div>
        </>
      )}
      {!fixed && (
        <>
          <Section label="Repo" />
          <div className="ui-group">
            <label className="as-date-row">
              <Icon name="repo" /><span>Repo</span>
              <em>{dirs.find((d) => d.cwd === repo)?.name}</em><Icon name="chevron-right" small />
              <select aria-label="Repo" value={repo} onChange={(e) => setPicked(e.target.value)}>
                {dirs.map((d) => <option key={d.cwd} value={d.cwd}>{d.name}</option>)}
              </select>
            </label>
          </div>
        </>
      )}
      {recent.length > 0 && (
        <>
          <Section label="Continue" />
          <div className="ui-group">
            {recent.map((s) => <Row key={s.sessionId} lines={1} leading={<Icon name="history" />} title={s.title.trim() || UNTITLED} meta={since(s.lastModified)} onClick={() => resume(s.sessionId)} />)}
          </div>
        </>
      )}
      {models.length > 0 && (
        <>
          <Section label="Model" />
          <div className="ui-group">
            <div className="ui-fields">
              <div className="gl-chips">{models.map((m) => <Chip key={m.value} on={m.value === checked} onClick={() => setModel(m.value)}>{m.displayName || m.value}</Chip>)}</div>
            </div>
          </div>
        </>
      )}
      <div className="gl-actions"><Button variant="filled" size="lg" onClick={go}>Start</Button></div>
    </Sheet>
  );
}
