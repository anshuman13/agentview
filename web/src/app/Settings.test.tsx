import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { hubDebug } from './hubDebug';
import { Settings, SettingsView } from './Settings';

vi.hoisted(() => {
  vi.stubGlobal('window', {});
});

describe('SettingsView', () => {
  it('shows Loading while the flag is pending, not the empty state', () => {
    const html = renderToStaticMarkup(<SettingsView showDesign={undefined} />);
    expect(html).toContain('Loading');
    expect(html).not.toContain('ui-empty');
  });

  it('shows the empty state without the About group when the flag is false', () => {
    const html = renderToStaticMarkup(<SettingsView showDesign={false} />);
    expect(html).toContain('ui-empty');
    expect(html).not.toContain('About');
    expect(html).not.toContain('Design');
  });

  it('shows the Design row under About when allowed', () => {
    const html = renderToStaticMarkup(<SettingsView showDesign />);
    expect(html).toContain('About');
    expect(html).toContain('Design');
    expect(html).toContain('Primitives and states');
    expect(html).not.toContain('ui-empty');
  });
});

describe('Settings', () => {
  it('shows the row at once in dev without asking the hub', () => {
    const debug = vi.fn(async () => false);
    expect(renderToStaticMarkup(<Settings dev debug={debug} />)).toContain('Design');
    expect(debug).not.toHaveBeenCalled();
  });

  it('shows Loading first outside dev', () => {
    expect(renderToStaticMarkup(<Settings dev={false} debug={async () => true} />)).toContain('Loading');
  });
});

describe('hubDebug', () => {
  const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('returns the hub flag', async () => {
    expect(await hubDebug(reply({ debug: true }))).toBe(true);
    expect(await hubDebug(reply({ debug: false }))).toBe(false);
  });

  it('returns false on a non-2xx and on a thrown fetch', async () => {
    expect(await hubDebug(reply({ debug: true }, 500))).toBe(false);
    expect(await hubDebug(vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch)).toBe(false);
  });
});
