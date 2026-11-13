import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { FEATURES } from '../../../shared/featureUse';
import { stubGlobal } from '../../../testing';

vi.mock('./featureUseApi', () => ({ postFeatureUse: vi.fn(() => Promise.resolve({ recorded: true })) }));
vi.mock('./store', () => ({ useStore: vi.fn(), api: vi.fn(), getState: () => ({ live: [], session: {}, ui: {} }), notice: vi.fn(), send: vi.fn(), setUi: vi.fn() }));
vi.mock('./runtime/notify', () => ({ toggleNotify: vi.fn() }));
vi.mock('../chat/chatActions', () => ({ forkChat: vi.fn() }));
vi.mock('../codex/view', () => ({ openMeeting: vi.fn(), openTask: vi.fn(), setView: vi.fn() }));
vi.mock('../sessions/goalLogic', () => ({ openGoal: vi.fn() }));
vi.mock('../sessions/advisorChat', () => ({ askAdvisor: vi.fn(), go: vi.fn() }));
vi.mock('../ui/util', () => ({ plural: vi.fn(), useReturnFocus: vi.fn(), listKeys: vi.fn(), Hl: vi.fn(), ago: vi.fn(), command: vi.fn() }));
vi.mock('../codex/tasks/time', () => ({ clock: vi.fn() }));

const { appSettings } = await import('./appSettings');
const { PAGES } = await import('./pages');
const { track } = await import('./featureUse');
const { postFeatureUse } = await import('./featureUseApi');
const { perform } = await import('./palette/paletteActions');

const post = postFeatureUse as ReturnType<typeof vi.fn>;

describe('track', () => {
  beforeEach(() => {
    post.mockClear();
    stubGlobal('window', { dispatchEvent: vi.fn() });
    stubGlobal('CustomEvent', class {});
  });

  it('sends nothing while off', () => {
    appSettings.patch({ featureUse: false });
    track('page:mcp');
    perform('model:x');
    expect(post).not.toHaveBeenCalled();
  });

  it('sends one post per action while on, and only for catalogue ids', () => {
    appSettings.patch({ featureUse: true });
    track('page:nope');
    perform('model:x');
    perform('page:mcp');
    expect(post.mock.calls).toEqual([['palette:model']]);
  });

  it('the catalogue holds every page', () => {
    expect(PAGES.map((p) => `page:${p.id}`).filter((id) => !FEATURES.some((f) => f.id === id))).toEqual([]);
  });
});
