import { describe, expect, it, vi } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';

const react = createRequire(import.meta.url)('react') as typeof import('react');
const { useSyncExternalStore } = react;
vi.mock('react', () => ({ ...react, useSyncExternalStore: (subscribe: never, get: () => unknown) => useSyncExternalStore(subscribe, get, get) }));

const { Row } = await import('./Transcript');

const html = (extra: object) => renderToStaticMarkup(<Row it={{ kind: 'user', id: 'u1', text: 'hi', at: 1, ...extra }} cwd="/w/app" />);

describe('sent prompt actions', () => {
  it('show Use again and Copy on a sent prompt, only Send now on a queued one', () => {
    const sent = html({});
    expect(sent).toContain('Use again');
    expect(sent).toContain('Copy');
    expect(sent).not.toContain('Send now');
    const queued = html({ queued: true });
    expect(queued).toContain('Send now');
    expect(queued).not.toContain('Use again');
    expect(queued).not.toContain('Copy');
  });

  it('show a mic glyph only for a spoken prompt', () => {
    expect(html({ voice: true })).toContain('codicon-mic');
    expect(html({})).not.toContain('codicon-mic');
  });
});
