import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Sheet } from './Sheet';

const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(Sheet, { label: 'Runs', onClose: () => {}, ...props } as never, createElement('p', null, 'body')));

describe('Sheet', () => {
  it('renders a labelled dialog with a handle and its children', () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Runs"');
    expect(html).toContain('class="sheet-handle"');
    expect(html).toContain('<p>body</p>');
    expect(html).toContain('class="as-sheet-overlay"');
  });

  it('appends className to as-sheet', () => {
    expect(render({ className: 'as-date' })).toContain('class="as-sheet as-date"');
  });

  it('replaces the default overlay class with overlayClassName', () => {
    const html = render({ overlayClassName: 'more-sheet-overlay' });
    expect(html).toContain('class="more-sheet-overlay"');
    expect(html).not.toContain('as-sheet-overlay');
  });
});
