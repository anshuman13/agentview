import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'bun:test';
import { Loading } from './Skeleton';

const html = (el: ReactElement) => renderToStaticMarkup(el);

describe('Loading', () => {
  it('shows a spinner and the default line as a status', () => {
    const out = html(createElement(Loading));
    expect(out).toContain('role="status"');
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('spin');
    expect(out).toContain('<span>Loading…</span>');
  });

  it('shows custom text', () => {
    expect(html(createElement(Loading, { text: 'Loading the audit…' }))).toContain('<span>Loading the audit…</span>');
  });
});
