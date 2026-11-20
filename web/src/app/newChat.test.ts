import { beforeEach, describe, expect, it } from 'bun:test';
import { stubGlobal } from '../../../testing';

const data = new Map<string, string>();
stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
const { appSettings } = await import('./appSettings');
const { modelGroup, rememberModel, rememberModels, startModel } = await import('./newChat');

const options = [
  { id: 'claude', label: 'Claude', modelSet: 'claude', enabled: true },
  { id: 'openrouter', label: 'OpenRouter', modelSet: 'claude', enabled: true },
  { id: 'codex', label: 'Codex', modelSet: 'codex', enabled: true },
] as const;
const models = (...values: string[]) => values.map((value) => ({ value, displayName: value }));

describe('start model', () => {
  beforeEach(() => { data.clear(); appSettings.patch({ providers: [...options], defaultProvider: 'claude' }); });

  it('shares one model set between Claude and OpenRouter', () => {
    expect(modelGroup('openrouter', [...options])).toBe('claude');
    expect(modelGroup('codex', [...options])).toBe('codex');
    expect(modelGroup(undefined, [])).toBe('claude');
  });

  it('keeps a last model per set and sends it only while the set lists it', () => {
    rememberModels('claude', models('opus', 'sonnet'));
    rememberModels('codex', models('gpt-5'));
    rememberModel('claude', 'sonnet');
    rememberModel('codex', 'gpt-5');
    expect(startModel()).toBe('sonnet');
    expect(startModel('openrouter')).toBe('sonnet');
    expect(startModel('codex')).toBe('gpt-5');
    rememberModels('claude', models('opus'));
    expect(startModel()).toBeUndefined();
  });

  it('follows the default provider when none is named', () => {
    rememberModels('codex', models('gpt-5'));
    rememberModel('codex', 'gpt-5');
    appSettings.patch({ defaultProvider: 'codex' });
    expect(startModel()).toBe('gpt-5');
  });
});
