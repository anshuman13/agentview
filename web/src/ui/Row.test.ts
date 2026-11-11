import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'bun:test';
import { MenuItem } from './Menu';
import { Row } from './Row';

const html = (el: ReactElement) => renderToStaticMarkup(el);

describe('Row state slot', () => {
  it('is drawn for null and for content, absent when the prop is not passed', () => {
    expect(html(createElement(Row, { title: 'A', state: null }))).toContain('ui-row-state');
    expect(html(createElement(Row, { title: 'A', state: 'Failed' }))).toContain('<span class="ui-row-state">Failed</span>');
    expect(html(createElement(Row, { title: 'A' }))).not.toContain('ui-row-state');
  });
});

describe('Row menu', () => {
  it('adds a More button beside the row button, never inside it', () => {
    const out = html(createElement(Row, { title: 'A', menu: createElement(MenuItem, null, 'Open') }));
    expect(out).toMatch(/^<div class="ui-row-wrap"><button[^>]*class="ui-row"/);
    expect(out).toMatch(/<\/button><button[^>]*aria-label="More"[^>]*aria-haspopup="menu"/);
  });

  it('has no menu button without menu items', () => {
    expect(html(createElement(Row, { title: 'A' }))).not.toContain('aria-haspopup');
  });
});
