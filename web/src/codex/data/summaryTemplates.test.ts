import { expect, test } from 'vitest';
import { templateFor } from './summaryTemplates';
import type { Meeting } from './wiki';

const meeting = (title: string, people: string[] = []) => ({ id: 'm1', profile: 'work', title, starts_at: 1, people: JSON.stringify(people) }) as unknown as Meeting;

test('guesses 1:1 from the title and from two guests', () => {
  expect(templateFor(meeting('Weekly sync'), [], {})).toBe('default');
  expect(templateFor(meeting('Ada 1:1 Grace'), [], {})).toBe('one_on_one');
  expect(templateFor(meeting('Sprint 11 planning'), [], {})).toBe('planning');
  expect(templateFor(meeting('Catch up', ['Ada', 'Grace']), [], {})).toBe('one_on_one');
});

test('a template picked for the series wins over the guess', () => {
  expect(templateFor(meeting('Weekly sync (3)', ['Ada', 'Grace']), [], { 'work:weekly sync': 'planning' })).toBe('planning');
});
