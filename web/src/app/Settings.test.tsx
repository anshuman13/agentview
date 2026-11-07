import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { hubDebug } from './hubDebug';
import { Settings, SettingsView, versionText } from './Settings';

vi.hoisted(() => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', { documentElement: { dataset: {} } });
});

describe('versionText', () => {
  it('shows the sha, then Unknown', () => {
    expect(versionText('def')).toBe('def');
    expect(versionText('')).toBe('Unknown');
  });
});

describe('SettingsView', () => {
  it('About shows the header and App version, and Design only when allowed', () => {
    const html = renderToStaticMarkup(<SettingsView />);
    expect(html).toContain('About');
    expect(html).toContain('App version');
    expect(html).not.toContain('Design');
    expect(html).not.toContain('ui-empty');
    const withDesign = renderToStaticMarkup(<SettingsView showDesign />);
    expect(withDesign.indexOf('App version')).toBeLessThan(withDesign.indexOf('Design'));
    expect(withDesign).toContain('Primitives and states');
  });

  it('Appearance shows the Theme row as a button with the theme name', () => {
    const html = renderToStaticMarkup(<SettingsView />);
    expect(html).toContain('Appearance');
    expect(html).toMatch(/<button type="button" class="ui-row"[^>]*>.*Theme.*Dark/);
  });

  it('Phone shows the installed version only when known', () => {
    const html = renderToStaticMarkup(<SettingsView phoneVersion="0.1.0+abc" />);
    expect(html).toContain('Phone');
    expect(html).toContain('Installed version');
    expect(html).toContain('0.1.0+abc');
    for (const none of [undefined, '']) {
      const bare = renderToStaticMarkup(<SettingsView phoneVersion={none} />);
      expect(bare).not.toContain('Phone');
      expect(bare).not.toContain('Installed version');
    }
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
    expect(html).not.toContain('Phone');
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
