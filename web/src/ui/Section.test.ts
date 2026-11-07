import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Section } from './Section';

const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(Section, { label: 'L', ...props } as never));

describe('Section', () => {
  it('renders a div head without onToggle', () => {
    const html = render({});
    expect(html).toContain('<div class="ui-section-head">');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('codicon-chevron-right');
  });

  it('renders a button head with aria-expanded and a chevron', () => {
    const toggle = () => {};
    const open = render({ onToggle: toggle, open: true });
    expect(open).toContain('<button type="button" class="ui-section-head" aria-expanded="true">');
    expect(open).toContain('codicon-chevron-right');
    expect(render({ onToggle: toggle, open: false })).toContain('aria-expanded="false"');
  });

  it('renders count including zero and omits it when undefined', () => {
    expect(render({ count: 3 })).toContain('<span class="badge quiet">3</span>');
    expect(render({ count: 0 })).toContain('<span class="badge quiet">0</span>');
    expect(render({})).not.toContain('badge');
  });

  it('renders the action in the actions span only when given', () => {
    expect(render({ action: createElement('i') })).toContain('<span class="ui-section-actions"><i></i></span>');
    expect(render({})).not.toContain('ui-section-actions');
  });

  it('puts the label in ui-section-label', () => {
    expect(render({})).toContain('<span class="ui-section-label">L</span>');
  });
});
