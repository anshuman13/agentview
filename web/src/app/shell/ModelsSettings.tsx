import { useEffect, useState } from 'react';
import { Button } from '../../ui/Button';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import type { Provider } from '../../../../shared/protocol';
import { MODEL_SLOTS, type ModelSlot, type OpenRouterModels, type OpenRouterView } from '../../../../shared/openrouter';
import { appSettings } from '../appSettings';
import { notice } from '../store';
import { fetchOpenRouter, saveDefaultProvider, saveOpenRouter } from './modelsApi';

const LABEL: Record<ModelSlot, string> = { opus: 'Opus slot', sonnet: 'Sonnet slot', haiku: 'Haiku slot', fable: 'Fable slot' };

export function ModelsSettings() {
  const [saved, setSaved] = useState('');
  const [key, setKey] = useState('');
  const [models, setModels] = useState<OpenRouterModels>({});
  const [main, setMain] = useState<ModelSlot>('sonnet');
  const [busy, setBusy] = useState(false);
  const codex = appSettings.use((s) => s.providers.find((p) => p.id === 'codex'));
  const enabled = appSettings.use((s) => s.providers.filter((p) => p.enabled));
  const defaultProvider = appSettings.use((s) => s.defaultProvider);
  const load = (v: OpenRouterView) => {
    setSaved(v.maskedKey);
    setModels(v.models);
    setMain(v.default);
    setKey('');
  };
  useEffect(() => {
    fetchOpenRouter().then(load, () => notice('Could not load the model settings'));
  }, []);
  const save = () => {
    setBusy(true);
    saveOpenRouter({ key, default: main, models })
      .then((v) => { load(v); notice('Model settings saved'); }, (err) => notice(err instanceof Error ? err.message : 'Could not save'))
      .finally(() => setBusy(false));
  };
  const pick = (id: Provider) =>
    saveDefaultProvider(id).then((s) => appSettings.patch({ defaultProvider: s.defaultProvider ?? 'claude' }), (err) => notice(err instanceof Error ? err.message : 'Could not save'));
  return (
    <>
      <Section label="Models" />
      <div className="ui-group">
        <Row plain title="OpenRouter" meta="Runs chats on OpenRouter models. The key stays on this Mac." />
        <div className="ui-fields">
          <input type="password" autoComplete="off" aria-label="OpenRouter key" placeholder={saved ? `Key saved (${saved}), type to replace` : 'OpenRouter key'} value={key} onChange={(e) => setKey(e.target.value)} />
          {MODEL_SLOTS.map((s) => (
            <input key={s} aria-label={LABEL[s]} placeholder={`${LABEL[s]}, an OpenRouter model id`} value={models[s] ?? ''} onChange={(e) => setModels({ ...models, [s]: e.target.value })} />
          ))}
          <select aria-label="Default model" value={main} onChange={(e) => setMain(e.target.value as ModelSlot)}>
            {MODEL_SLOTS.map((s) => <option key={s} value={s}>Default: {LABEL[s]}</option>)}
          </select>
          <Button variant="filled" disabled={busy} onClick={save}>Save</Button>
        </div>
        {codex && <Row plain title="Codex" meta={codex.enabled ? 'Pick Codex when you start a chat' : codex.note} />}
        <div className="ui-fields">
          <select aria-label="Default provider" value={enabled.some((p) => p.id === defaultProvider) ? defaultProvider : enabled[0]?.id} onChange={(e) => pick(e.target.value as Provider)}>
            {enabled.map((p) => <option key={p.id} value={p.id}>New chats: {p.label}</option>)}
          </select>
        </div>
      </div>
    </>
  );
}
