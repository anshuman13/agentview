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

  it('opens the link in a new tab', () => {
    const html = render({ href: 'https://example.com' });
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  it('passes extra props to a plain row', () => {
    expect(render({ plain: true, 'data-x': '1' })).toMatch(/^<div class="ui-row" data-x="1">/);
  });

  it('renders a plain row with href as a div', () => {
    const html = render({ plain: true, href: 'https://example.com' });
    expect(html).toMatch(/^<div class="ui-row">/);
    expect(html).not.toContain('<a ');
  });

  it('renders meta and trailing only when given', () => {
    const html = render({ meta: 'm', trailing: 'r' });
    expect(html).toContain('<span class="ui-row-meta">m</span>');
    expect(html).toContain('<span class="ui-row-trail">r</span>');
    const bare = render({});
    expect(bare).not.toContain('ui-row-meta');
    expect(bare).not.toContain('ui-row-trail');
  });

  it('gives a default title no two class', () => {
    expect(render({})).toContain('class="ui-row-title"');
  });

  it('renders the action after the button', () => {
    expect(render({ action: createElement('i') })).toMatch(/<\/button><i><\/i><\/div>$/);
  });

  it('wraps only a button row with an action', () => {
    expect(render({})).not.toContain('ui-row-wrap');
    expect(render({ plain: true })).not.toContain('ui-row-wrap');
    expect(render({ href: 'https://example.com' })).not.toContain('ui-row-wrap');
  });

  it('has no lead markup without leading', () => {
    const html = render({});
    expect(html).not.toContain('has-lead');
    expect(html).not.toContain('ui-row-lead');
  });

  it('renders the same props to the same markup', () => {
    expect(render({ leading: 'x', meta: 'm' })).toBe(render({ leading: 'x', meta: 'm' }));
  });
});
