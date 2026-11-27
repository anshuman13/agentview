import { describe, expect, it, vi } from 'bun:test';
import { createRequire } from 'node:module';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { stubGlobal } from '../../../../testing';
import * as buttonModule from '../../ui/Button';
import type { Agent } from '../agents';

stubGlobal('document', { documentElement: { dataset: {}, style: {} }, visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} });
stubGlobal('window', { matchMedia: () => ({ matches: false }), addEventListener: () => {}, removeEventListener: () => {} });
stubGlobal('matchMedia', () => ({ matches: false }));
stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
stubGlobal('location', { search: '', hash: '' });

const react = createRequire(import.meta.url)('react') as typeof import('react');
vi.mock('react', () => ({ ...react, useSyncExternalStore: (subscribe: never, get: () => unknown) => react.useSyncExternalStore(subscribe, get, get) }));
const icons: ComponentProps<typeof buttonModule.IconButton>[] = [];
const RealIconButton = buttonModule.IconButton;
vi.mock('../../ui/Button', () => ({ ...buttonModule, IconButton: (p: ComponentProps<typeof RealIconButton>) => { icons.push(p); return <RealIconButton {...p} />; } }));
vi.mock('../useChatRun', () => ({ useChatRun: () => undefined }));
const { RailHead } = await import('./RailHead');
const { agentBack } = await import('../agents');

const back = () => icons.find((p) => p.icon === 'arrow-left');

describe('agents back', () => {
  it('leads the rail head with a back arrow only while an agent is open', () => {
    icons.length = 0;
    expect(renderToStaticMarkup(<RailHead />)).not.toContain('Back to agents');
    expect(back()).toBeUndefined();
    const onBack = vi.fn();
    const html = renderToStaticMarkup(<RailHead onBack={onBack} />);
    expect(html).toContain('aria-label="Back to agents"');
    expect(html.indexOf('Back to agents')).toBeLessThan(html.indexOf('rail-title'));
    (back()!.onClick as () => void)();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('goes back only from an agent still in the chat, so Escape closes the sheet from the list', () => {
    const agents = [{ id: 'a' }, { id: 'b' }] as Agent[];
    const clear = () => {};
    expect(agentBack(agents, 'b', clear)).toBe(clear);
    expect(agentBack(agents, null, clear)).toBeUndefined();
    expect(agentBack(agents, 'gone', clear)).toBeUndefined();
  });
});
