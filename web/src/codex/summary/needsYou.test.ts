import { expect, it } from 'vitest';
import { needsYou } from './Summary';

it('keeps reading bullets after an intro line and stops at the next heading', () => {
  const text = ['## Needs you', 'These are waiting on you:', '- [Review](https://x.test/1): Ann asked. More later.', '- **Budget**: due Friday', '## FYI', '- Not this'].join('\n');
  expect(needsYou(text)).toEqual([
    { title: 'Review', url: 'https://x.test/1', why: 'Ann asked.' },
    { title: 'Budget', url: null, why: 'due Friday' },
  ]);
});

it('drops links that are not http or mailto', () => {
  expect(needsYou('## Needs you\n- [Fix](javascript:alert(1)): now')[0].url).toBeNull();
});
