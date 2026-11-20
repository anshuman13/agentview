import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'bun:test';
import { Button } from './Button';

const html = (el: ReactElement) => renderToStaticMarkup(el);

describe('Button', () => {
  it('renders a button by default', () => {
    expect(html(createElement(Button, { variant: 'filled', size: 'sm' }, 'Go'))).toBe('<button type="button" class="btn btn-filled btn-sm">Go</button>');
  });

  it('renders an anchor with href, target and rel and the same classes', () => {
    const out = html(createElement(Button, { variant: 'filled', size: 'sm', href: 'https://x.test', target: '_blank', rel: 'noreferrer' }, 'Join'));
    expect(out).toBe('<a class="btn btn-filled btn-sm" href="https://x.test" target="_blank" rel="noreferrer">Join</a>');
  });
});
