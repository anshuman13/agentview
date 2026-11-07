import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Chip, chipClass } from './Button';

describe('Chip', () => {
  it('adds tone and quiet classes', () => {
    const html = renderToStaticMarkup(createElement(Chip, { tone: 'accent', quiet: true, on: true }, 'x'));
    expect(html).toContain('class="chip chip-btn on chip-accent chip-quiet"');
  });

  const chip = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(Chip, props as never, 'x'));

  it('renders a button by default', () => {
    expect(chip({})).toBe('<button type="button" class="chip chip-btn">x</button>');
  });

  it('adds size and late classes', () => {
    expect(chip({ size: 'sm' })).toContain('class="chip chip-btn chip-sm"');
    expect(chip({ late: true })).toContain('class="chip chip-btn late"');
  });

  it('renders the icon before the children', () => {
    const html = chip({ icon: 'add' });
    expect(html).toContain('codicon-add');
    expect(html.indexOf('codicon-add')).toBeLessThan(html.indexOf('>x<'));
  });

  it('renders a link with href', () => {
    const html = chip({ href: 'https://example.com', target: '_blank', rel: 'noreferrer', title: 'T', 'aria-label': 'A', type: 'submit' });
    expect(html).toMatch(/^<a class="chip chip-btn"/);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain('title="T"');
    expect(html).toContain('aria-label="A"');
    expect(html).not.toContain('type=');
  });

  it('appends a custom className last', () => {
    expect(chip({ tone: 'accent', quiet: true, className: 'mine' })).toContain('class="chip chip-btn chip-accent chip-quiet mine"');
  });

  it('chipClass matches Chip', () => {
    expect(chipClass({ tone: 'work', late: true })).toBe('chip chip-btn late chip-work');
  });
});
