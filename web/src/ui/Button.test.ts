import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Chip, chipClass } from './Button';

describe('Chip', () => {
  it('adds tone and quiet classes', () => {
    const html = renderToStaticMarkup(createElement(Chip, { tone: 'accent', quiet: true, on: true }, 'x'));
    expect(html).toContain('class="chip chip-btn on chip-accent chip-quiet"');
  });

  it('chipClass matches Chip', () => {
    expect(chipClass({ tone: 'work', late: true })).toBe('chip chip-btn late chip-work');
  });
});
