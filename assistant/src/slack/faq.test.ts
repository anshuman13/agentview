import { expect, test } from 'bun:test';
import { peopleInput, saveOwners } from './people.js';
import { openDb } from '../core/db.js';
import { FAQ_PAGE, saveFaqs } from './faq.js';
import { saveVoice, voiceLines } from './voice.js';

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

test('a learned voice feeds the draft step and proposes its traits once', () => {
  const db = openDb(':memory:');
  expect(voiceLines(db)).toEqual([]);
  const v = { note: 'Short, direct, no greeting.', traits: ['I skip greetings.', 'I end with a question.'], examples: ['On it, back by 3.'] };
  expect(saveVoice(db, v, 1)).toBe(2);
  expect(saveVoice(db, v, 2)).toBe(0);
  expect(voiceLines(db)).toEqual(['Write each draft the way I write: Short, direct, no greeting. Messages I wrote, for the tone: "On it, back by 3."']);
  expect(db.prepare("SELECT COUNT(*) AS n FROM facts WHERE state = 'proposed' AND added_by = 'voice'").get()).toEqual({ n: 2 });
});

test('saveOwners proposes one claim per person and thing on a proposed Who does what page', () => {
  const db = openDb(':memory:');
  const now = Date.now();
  const o = { person: 'Kim Berg', thing: 'the invoice export', url: 'https://x.slack.com/archives/C1/p1', at: '28 Oct 2026', heading: 'Systems' };
  expect(saveOwners(db, [o, { ...o, url: '' }, { ...o, thing: 'the budget sheet' }], now)).toBe(2);
  const rows = db.prepare("SELECT text, state, heading FROM facts ORDER BY text").all();
  expect(rows).toEqual([
    { text: 'As of 28 Oct 2026, Kim Berg owns the budget sheet.', state: 'proposed', heading: 'Systems' },
    { text: 'As of 28 Oct 2026, Kim Berg owns the invoice export.', state: 'proposed', heading: 'Systems' },
  ]);
  expect(db.prepare("SELECT title, state FROM pages").get()).toEqual({ title: 'Who does what', state: 'proposed' });
  expect(peopleInput(db, now)).toContain('Chat summaries:');
});
