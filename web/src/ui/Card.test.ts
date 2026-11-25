import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'bun:test';
import { Card, CardGrid } from './Card';

const html = (props: Parameters<typeof Card>[0]) => renderToStaticMarkup(createElement(Card, props));

describe('Card', () => {
  it('puts the cover above the title and caption', () => {
    const out = html({ title: 'Oslo', meta: '2d ago', cover: createElement('img', { src: 'x.png', alt: '' }) });
    expect(out).toMatch(/<button type="button" class="ui-card"><span class="ui-card-cover"><img[^>]*><\/span><span class="ui-card-body"><span class="ui-card-title" title="Oslo">Oslo<\/span><span class="ui-card-meta">2d ago<\/span>/);
  });

  it('leaves out cover and caption when not given', () => {
    const out = html({ title: 'A' });
    expect(out).not.toContain('ui-card-cover');
    expect(out).not.toContain('ui-card-meta');
  });

  it('marks selection with a class and aria-pressed only when set', () => {
    expect(html({ title: 'A', selected: true })).toContain('class="ui-card selected" aria-pressed="true"');
    expect(html({ title: 'A' })).not.toContain('aria-pressed');
  });

  it('keeps extra content such as chips inside the body', () => {
    const out = html({ title: 'A', children: createElement('span', { className: 'chip' }, 'Current') });
    expect(out).toContain('<span class="chip">Current</span></span></button>');
  });

  it('wraps cards in a grid', () => {
    expect(renderToStaticMarkup(createElement(CardGrid, { className: 'trips' }))).toBe('<div class="ui-card-grid trips"></div>');
  });
});
