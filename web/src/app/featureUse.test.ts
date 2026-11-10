import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FEATURES } from '../../../shared/featureUse';
import { appSettings } from './appSettings';
import { PAGES } from './pages';
import { track } from './featureUse';
import { postFeatureUse } from './featureUseApi';
import { perform } from './palette/paletteActions';

vi.mock('./featureUseApi', () => ({ postFeatureUse: vi.fn(() => Promise.resolve({ recorded: true })) }));
vi.mock('./store', () => ({ getState: () => ({ live: [], session: {}, ui: {} }), notice: vi.fn(), send: vi.fn(), setUi: vi.fn() }));
vi.mock('./runtime/notify', () => ({ toggleNotify: vi.fn() }));
vi.mock('../chat/chatActions', () => ({ forkChat: vi.fn() }));
vi.mock('../codex/view', () => ({ openMeeting: vi.fn(), openTask: vi.fn(), setView: vi.fn() }));
vi.mock('../sessions/goalLogic', () => ({ openGoal: vi.fn() }));
vi.mock('../ui/util', () => ({ ago: vi.fn(), command: vi.fn() }));
vi.mock('../codex/tasks/time', () => ({ clock: vi.fn() }));

const post = vi.mocked(postFeatureUse);

describe('track', () => {
  beforeEach(() => {
    post.mockClear();
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    vi.stubGlobal('CustomEvent', class {});
  });

  it('sends nothing while off', () => {
    appSettings.patch({ featureUse: false });
    track('page:builds');
    perform('model:x');
    expect(post).not.toHaveBeenCalled();
  });

  it('sends one post per action while on, and only for catalogue ids', () => {
    appSettings.patch({ featureUse: true });
    track('page:nope');
    perform('model:x');
    perform('page:builds');
    expect(post.mock.calls).toEqual([['palette:model']]);
  });

  it('the catalogue holds every page', () => {
    expect(PAGES.map((p) => `page:${p.id}`).filter((id) => !FEATURES.some((f) => f.id === id))).toEqual([]);
  });
});
