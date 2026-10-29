import { describe, expect, it } from 'vitest';
import { searchMeetings, type Meeting } from './wiki';

const filler = 'the quick brown fox jumps over the lazy dog and talks about roadmap and hiring '.repeat(400);

const meetings = (n: number): Meeting[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `m${i}`, profile: 'work', version: 0, updated_at: 0, deleted: 0, field_times: '{}', dirty: 0,
    title: `Meeting ${i}`, people: '["a","b"]', notes: 'notes', summary: 'summary', decisions: null, transcript: `${filler} marker${i}`,
    starts_at: i, ends_at: i + 1,
  }) as unknown as Meeting);

describe('searchMeetings timing', () => {
  it('logs first and repeated call times over 500 meetings', () => {
    const rows = meetings(500);
    const time = (q: string) => {
      const t = performance.now();
      const found = searchMeetings(rows, q);
      return { ms: performance.now() - t, found: found.length };
    };
    const first = time('roadmap hiring');
    const repeats = ['r', 'ro', 'roa', 'road', 'roadm', 'roadma', 'roadmap'].map(time);
    const avg = repeats.reduce((s, r) => s + r.ms, 0) / repeats.length;
    console.log(`searchMeetings 500x30KB: first ${first.ms.toFixed(1)} ms, repeated avg ${avg.toFixed(2)} ms`);
    expect(first.found).toBe(500);
  });
});
