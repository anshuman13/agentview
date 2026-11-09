import { expect, test } from 'bun:test';
import { correctionLines, correctionsDue, correctionsPrompt, gatherPairs, learnCorrections, saveRules } from './corrections.js';
import { openDb, setMeta } from '../core/db.js';
import { DAY } from '../core/time.js';

const now = new Date(2026, 10, 4, 12).getTime();

function withReplies() {
  const db = openDb(':memory:');
  const add = db.prepare('INSERT INTO replies (profile, id, status, text, why, draft_text, skip_reason, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  add.run('work', 'r1', 'sent', 'Yes.', null, 'Yes, that works for me, happy to help with it.', null, now - DAY);
  add.run('work', 'r2', 'skipped', null, 'skipped from the push', 'Looking into it.', 'not mine to answer', now - 2 * DAY);
  add.run('work', 'r3', 'skipped', null, 'skipped from the push', 'Will check.', null, now - 3 * DAY);
  add.run('work', 'r4', 'sent', 'Same text.', null, 'Same text.', null, now - DAY);
  add.run('work', 'r5', 'sent', 'No draft kept.', null, null, null, now - DAY);
  add.run('work', 'r6', 'sent', 'Old.', null, 'Old draft.', null, now - 20 * DAY);
  return db;
}

test('gatherPairs takes edited and skipped rows of the last 14 days that kept a draft', () => {
  expect(gatherPairs(withReplies(), now)).toEqual([
    { original: 'Will check.', final: null, reason: 'skipped from the push' },
    { original: 'Looking into it.', final: null, reason: 'not mine to answer' },
    { original: 'Yes, that works for me, happy to help with it.', final: 'Yes.', reason: null },
  ]);
});

test('correctionsPrompt lists each draft with what I did', () => {
  const text = correctionsPrompt(gatherPairs(withReplies(), now));
  expect(text).toContain('1. Draft: Will check.\n   Skipped: skipped from the push');
  expect(text).toContain('3. Draft: Yes, that works for me, happy to help with it.\n   I sent: Yes.');
});

test('learnCorrections does not call the model with fewer than 3 pairs', async () => {
  const db = withReplies();
  db.prepare("DELETE FROM replies WHERE id = 'r3'").run();
  expect(await learnCorrections(db, now)).toEqual({ pairs: 0 });
});

test('correctionLines is empty without rules and numbers them when there are some', () => {
  const db = openDb(':memory:');
  expect(correctionLines(db)).toEqual([]);
  setMeta(db, 'draft:rules', JSON.stringify({ rules: ['Answer a yes or no question with one line.', 'Skip drafts for questions about billing.'], at: now }));
  expect(correctionLines(db)).toEqual(['When drafting, also follow these corrections I made to earlier drafts: 1. Answer a yes or no question with one line. 2. Skip drafts for questions about billing.']);
});

test('saveRules proposes each rule once on the How I write page', () => {
  const db = openDb(':memory:');
  expect(saveRules(db, ['Answer with one line.', ' Leave out greetings. ', ''], now)).toBe(2);
  expect(saveRules(db, ['Answer with one line.', 'Leave out greetings.', 'Name the owner.'], now + 1)).toBe(1);
  const rows = db.prepare('SELECT text, heading, state, added_by FROM facts ORDER BY text').all();
  expect(rows).toEqual([
    { text: 'Answer with one line.', heading: 'Corrections', state: 'proposed', added_by: 'corrections' },
    { text: 'Leave out greetings.', heading: 'Corrections', state: 'proposed', added_by: 'corrections' },
    { text: 'Name the owner.', heading: 'Corrections', state: 'proposed', added_by: 'corrections' },
  ]);
  expect(db.prepare("SELECT count(*) AS n FROM pages WHERE title = 'How I write'").get()).toEqual({ n: 1 });
});

test('correctionsDue fires on a Monday once a week', () => {
  const monday = new Date(2026, 10, 2, 7, 5).getTime();
  expect(correctionsDue(0, monday)).toBe(true);
  expect(correctionsDue(monday - 7 * DAY, monday)).toBe(true);
  expect(correctionsDue(monday - DAY, monday)).toBe(false);
  expect(correctionsDue(0, monday + DAY)).toBe(false);
});
