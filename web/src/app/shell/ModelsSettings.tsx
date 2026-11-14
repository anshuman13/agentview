import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, IconButton } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { Sheet } from '../../ui/Sheet';
import type { Provider } from '../../../../shared/protocol';
import { MODEL_SLOTS, type ModelSlot, type OpenRouterModels, type OpenRouterView } from '../../../../shared/openrouter';
import { appSettings, loadAppSettings } from '../appSettings';
import { notice } from '../store';
import { fetchOpenRouter, saveDefaultProvider, saveOpenRouter } from './modelsApi';
import { useNarrow } from './useNarrow';

const NAME: Record<ModelSlot, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' };

export function ModelsSettings() {
  const narrow = useNarrow();
  const [view, setView] = useState<OpenRouterView | null>(null);
  const [key, setKey] = useState('');
  const [models, setModels] = useState<OpenRouterModels>({});
  const [main, setMain] = useState<ModelSlot>('sonnet');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState(false);
  const codex = appSettings.use((s) => s.providers.find((p) => p.id === 'codex'));
  const providers = appSettings.use((s) => s.providers);
  const enabled = useMemo(() => providers.filter((p) => p.enabled), [providers]);
  const defaultProvider = appSettings.use((s) => s.defaultProvider);
  const current = enabled.some((p) => p.id === defaultProvider) ? defaultProvider : enabled[0]?.id;
  const load = (v: OpenRouterView) => {
    setView(v);
    setModels(v.models);
    setMain(v.default);
    setKey('');
  };
  useEffect(() => {
    fetchOpenRouter().then(load, () => notice('Could not load the model settings'));
  }, []);
  const close = () => {
    if (view) load(view);
    setOpen(false);
  };
  const save = () => {
    setBusy(true);
    saveOpenRouter({ key, default: main, models })
      .then((v) => { load(v); setOpen(false); notice('Model settings saved'); void loadAppSettings(); }, (err) => notice(err instanceof Error ? err.message : 'Could not save'))
      .finally(() => setBusy(false));
  };
  const pick = (id: Provider) =>
    saveDefaultProvider(id).then((s) => appSettings.patch({ defaultProvider: s.defaultProvider ?? 'claude' }), (err) => notice(err instanceof Error ? err.message : 'Could not save'));
  const value = !view ? '' : view.hasKey ? `Key saved · ${NAME[view.default]}` : 'Not set';
  const form = (
    <>
      <div className="ui-fields">
        <input type="password" autoComplete="off" aria-label="OpenRouter key" placeholder={view?.maskedKey ? `Key saved (${view.maskedKey}), type to replace` : 'OpenRouter key'} value={key} onChange={(e) => setKey(e.target.value)} />
        {MODEL_SLOTS.map((s) => (
          <input key={s} aria-label={`${NAME[s]} slot`} placeholder={`${NAME[s]} slot, an OpenRouter model id`} value={models[s] ?? ''} onChange={(e) => setModels({ ...models, [s]: e.target.value })} />
        ))}
      </div>
      <Row plain title="Default model" trailing={
        <div className="gl-chips" role="group" aria-label="Default model">
          {MODEL_SLOTS.map((s) => <Chip key={s} on={main === s} aria-pressed={main === s} onClick={() => setMain(s)}>{NAME[s]}</Chip>)}
        </div>
      } />
      <div className="st-actions">
        {!narrow && <Button size="sm" onClick={close}>Cancel</Button>}
        <Button size="sm" variant="filled" disabled={busy} onClick={save}>Save</Button>
      </div>
    </>
  );
  return (
    <>
      <Section label="Models" action={<IconButton icon="info" label="About models" size="sm" onClick={() => setInfo(true)} />} />
      <div className="ui-group">
        <Row title="OpenRouter" meta={value} aria-expanded={open} trailing={<Icon name={open && !narrow ? 'chevron-down' : 'chevron-right'} small />} onClick={() => (open ? close() : setOpen(true))} />
        {open && !narrow && form}
        {codex && <Row plain title="Codex" meta={codex.enabled ? 'Logged in' : codex.note} />}
        {enabled.length > 1 ? (
          <Row plain title="New chats" trailing={
            <div className="gl-chips" role="group" aria-label="Default provider">
              {enabled.map((p) => <Chip key={p.id} on={p.id === current} aria-pressed={p.id === current} onClick={() => void pick(p.id)}>{p.label}</Chip>)}
            </div>
          } />
        ) : enabled[0] && <Row plain title="New chats" meta={enabled[0].label} />}
      </div>
      {open && narrow && (
        <Sheet label="OpenRouter" onClose={close}>
          <Section label="OpenRouter" />
          <div className="ui-group">{form}</div>
        </Sheet>
      )}
      {info && (
        <Sheet label="Models" onClose={() => setInfo(false)} className="as-dialog">
          <Section label="Models" />
          <div className="ui-group">
            <Row plain lines={2} title="OpenRouter runs chats on OpenRouter models. The key stays on this Mac." />
            <Row plain lines={2} title="Each slot is the OpenRouter model a chat gets when it asks for that Claude model. An empty slot uses the default one." />
          </div>
        </Sheet>
      )}
    </>
  );
}
