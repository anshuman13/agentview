import { beforeEach, describe, expect, it, vi } from 'bun:test';
import * as React from 'react';
import { stubGlobal } from '../../../testing';

stubGlobal('document', { documentElement: { dataset: {} }, activeElement: null });
vi.mock('react', () => ({ ...React, useSyncExternalStore: (_sub: unknown, get: () => unknown) => get() }));

const { openWikiFrom, setView, useView, wikiBack } = await import('./view');
const current = () => useView();

describe('wiki back', () => {
  beforeEach(() => {
    wikiBack();
    setView({ list: 'meetings', open: 'work:m1', anchor: null, person: 'Ana', series: null, tag: null });
  });

  it('returns to the person page a claim was opened from', () => {
    openWikiFrom('p1', 'f1');
    expect(current()).toMatchObject({ list: 'wiki', open: 'p1', anchor: 'f1', person: null });
    wikiBack();
    expect(current()).toMatchObject({ list: 'meetings', open: 'work:m1', anchor: null, person: 'Ana' });
  });

  it('goes to the wiki start page when nothing is saved', () => {
    setView({ list: 'wiki', open: 'p1', person: null });
    wikiBack();
    expect(current()).toMatchObject({ list: 'wiki', open: null, anchor: null });
  });

  it('forgets the return point after a list change in between', () => {
    openWikiFrom('p1', 'f1');
    setView({ list: 'tasks' });
    setView({ list: 'wiki', open: 'p2' });
    wikiBack();
    expect(current()).toMatchObject({ list: 'wiki', open: null });
  });

  it('forgets the return point when another wiki page opens', () => {
    openWikiFrom('p1', 'f1');
    setView({ open: 'p2', anchor: null });
    wikiBack();
    expect(current()).toMatchObject({ list: 'wiki', open: null });
  });
});

describe('transcript hit', () => {
  it('opens the meeting with the query once for that meeting only', async () => {
    const { openMeetingAt, transcriptQueryFor, clearTranscriptQuery } = await import('./view');
    openMeetingAt({ profile: 'work', id: 'm2' }, ' budget ');
    expect(current()).toMatchObject({ list: 'meetings', open: 'work:m2' });
    expect(transcriptQueryFor('work:m2')).toBe('budget');
    expect(transcriptQueryFor('work:m3')).toBe('');
    clearTranscriptQuery();
    expect(transcriptQueryFor('work:m2')).toBe('');
  });
});
