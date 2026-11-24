import { expect, it } from 'bun:test';
import { canDelegate, ideaTitle, pickIdeas } from './ideas';

it('picks open tasks an agent could take on, soonest first', () => {
  expect(canDelegate('Draft the Q3 memo')).toBe(true);
  expect(canDelegate('Dentist')).toBe(false);
  const t = (key: string, title: string, due: number | null) => ({ key, title, due });
  const got = pickIdeas([t('a', 'Review PR', null), t('b', 'Call mum', 1), t('c', 'Research venues', 5), t('d', 'Write notes', 2), t('e', 'Fix bug', 3)], ['e']);
  expect(got.map((x) => x.key)).toEqual(['d', 'c', 'a']);
  expect(ideaTitle('Draft the memo')).toBe('I can help: draft the memo');
});
