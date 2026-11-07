import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Row } from './Row';

const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(Row, { title: 't', ...props } as never));

describe('Row', () => {
  it('renders a button row', () => {
    expect(render({})).toContain('<button type="button" class="ui-row">');
  });

  it('renders a link row with href', () => {
    expect(render({ href: 'https://example.com' })).toMatch(/^<a class="ui-row" href=/);
  });

  it('renders a plain row as a div', () => {
    expect(render({ plain: true })).toMatch(/^<div class="ui-row">/);
  });

  it('marks a row with leading content', () => {
    expect(render({ leading: 'x' })).toContain('class="ui-row has-lead"');
  });

  it('marks a two line title', () => {
    expect(render({ lines: 2 })).toContain('class="ui-row-title two"');
  });

  it('wraps a row with an action', () => {
    expect(render({ action: createElement('i') })).toMatch(/^<div class="ui-row-wrap"><button/);
  });
});
