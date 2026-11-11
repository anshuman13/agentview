import { describe, expect, it } from 'bun:test';
import { pendingPatch } from './draft';

describe('pendingPatch', () => {
  it('is empty when nothing changed', () => {
    expect(pendingPatch('Call Kim', 'notes', { title: 'Call Kim', text: 'notes' })).toEqual({});
  });
  it('trims the title and keeps the old one when the field is blank', () => {
    expect(pendingPatch('  Call Kim again ', 'notes', { title: 'Call Kim', text: 'notes' })).toEqual({ title: 'Call Kim again' });
    expect(pendingPatch('   ', 'notes', { title: 'Call Kim', text: 'notes' })).toEqual({});
  });
  it('saves cleared notes as null', () => {
    expect(pendingPatch('Call Kim', '  \n', { title: 'Call Kim', text: 'notes' })).toEqual({ text: null });
    expect(pendingPatch('Call Kim', 'more', { title: 'Call Kim', text: '' })).toEqual({ text: 'more' });
  });
});
