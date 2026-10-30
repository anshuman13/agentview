import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PendingPermission } from '../../../shared/protocol';
import { lineDiff, PermissionCard } from './Pending';

describe('lineDiff', () => {
  it('keeps shared lines and puts removals before additions', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc')).toEqual([[' ', 'a'], ['-', 'b'], ['+', 'B'], [' ', 'c']]);
  });
});

describe('PermissionCard', () => {
  it('drops Always allow and the Y hint when confirmation is required', () => {
    const p: PendingPermission = { id: 'p1', kind: 'permission', toolName: 'Bash', title: 'Run a shell command', input: { command: 'rm -rf dist' }, canAlwaysAllow: false, confirmFirst: true };
    const out = renderToStaticMarkup(createElement(PermissionCard, { p, mode: 'default', first: true }));
    expect(out).not.toContain('Always allow');
    expect(out).not.toContain('<kbd>Y</kbd>');
    expect(out).toContain('Deny<kbd>N</kbd>');
  });
});
