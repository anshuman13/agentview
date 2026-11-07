import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { hubDebug } from './hubDebug';
import { Settings, SettingsView, versionText } from './Settings';

vi.hoisted(() => {
  vi.stubGlobal('window', {});
});

describe('versionText', () => {
  it('prefers the Tauri version, then the sha, then Unknown', () => {
    expect(versionText('0.1.0+abc', 'def')).toBe('0.1.0+abc');
    expect(versionText('', 'def')).toBe('def');
    expect(versionText(undefined, 'def')).toBe('def');
    expect(versionText('', '')).toBe('Unknown');
  });
});

describe('SettingsView', () => {
  it('shows the App version row as a plain row without the Design row', () => {
    const html = renderToStaticMarkup(<SettingsView version="abc123" />);
    expect(html).toContain('About');
    expect(html).toContain('App version');
    expect(html).toContain('abc123');
    expect(html).not.toContain('Design');
    expect(html).not.toContain('ui-empty');
    expect(html).not.toContain('<button');
  });

  it('shows the Design row under the App version row when allowed', () => {
    const html = renderToStaticMarkup(<SettingsView showDesign version="abc123" />);
    expect(html.indexOf('App version')).toBeLessThan(html.indexOf('Design'));
    expect(html).toContain('Primitives and states');
  });
});

describe('Settings', () => {
  it('shows the Design row at once in dev without asking the hub', () => {
    const debug = vi.fn(async () => false);
    expect(renderToStaticMarkup(<Settings dev debug={debug} appVersion={async () => ''} />)).toContain('Design');
    expect(debug).not.toHaveBeenCalled();
  });

  it('shows the version, never Loading, outside dev while the flag is pending', () => {
    const html = renderToStaticMarkup(<Settings dev={false} debug={async () => true} appVersion={async () => '0.1.0+abc'} />);
    expect(html).toContain('App version');
    expect(html).not.toContain('Loading');
    expect(html).not.toContain('Design');
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
