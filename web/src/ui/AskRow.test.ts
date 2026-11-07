import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AskRow } from './AskRow';

const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(AskRow, { title: 't', ...props } as never));

describe('AskRow', () => {
  it('wraps a button row in ov-ask', () => {
    expect(render({})).toMatch(/^<div class="ov-ask"><div class="ui-row-wrap"><button type="button" class="ui-row">/);
  });

  it('renders actions inside the wrap after the row', () => {
    const html = render({ actions: createElement('i') });
    expect(html).toContain('</button><span class="ov-ask-actions"><i></i></span></div>');
    expect(render({})).not.toContain('ov-ask-actions');
  });

  it('renders children after the wrap', () => {
    expect(render({ children: createElement('p') })).toMatch(/<\/div><p><\/p><\/div>$/);
  });

  it('passes row props to the Row', () => {
    const html = render({ meta: 'm', leading: 'x' });
    expect(html).toContain('class="ui-row has-lead"');
    expect(html).toContain('<span class="ui-row-meta">m</span>');
    expect(html).toContain('<span class="ui-row-title">t</span>');
  });
});
