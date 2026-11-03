import { expect, test } from 'bun:test';
import { openDb } from './db.js';
import { FAQ_PAGE, saveFaqs } from './faq.js';

test('answered questions become proposed claims on one FAQ page, once per permalink', () => {
  const db = openDb(':memory:');
  const now = new Date(2026, 10, 3).getTime();
  const f = { question: 'How do I get a seat', answer: 'Ask in the channel with your team name; Kim adds you within a day.', url: 'https://x.slack.com/archives/C1/p1', by: 'Kim', heading: 'Access', at: '28 Oct 2026' };
  expect(saveFaqs(db, 'ai-help', [f, { ...f, url: 'not a url' }], now)).toBe(1);
  expect(saveFaqs(db, 'ai-help', [f], now + 1)).toBe(0);
  const page = db.prepare('SELECT id, title, section, state FROM pages WHERE profile = ?').all('work');
  expect(page).toEqual([{ id: expect.any(String), title: FAQ_PAGE, section: 'Support', state: 'proposed' }]);
  const claim = db.prepare('SELECT text, heading, state, page_id, added_by FROM facts WHERE profile = ?').get('work');
  expect(claim).toEqual({ text: 'How do I get a seat? Ask in the channel with your team name; Kim adds you within a day.', heading: 'Access', state: 'proposed', page_id: (page[0] as { id: string }).id, added_by: 'faq:ai-help' });
});
