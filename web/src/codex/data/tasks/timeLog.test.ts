import { describe, expect, it } from 'bun:test';
import { appendSession, parseLog, removeSession } from './timeLog';

const a = { id: 'a', at: 1000, min: 25 };
const b = { id: 'b', at: 2000, min: 10 };

describe('time log', () => {
  it('reads malformed or non-list values as empty', () => {
    expect(parseLog(null)).toEqual([]);
    expect(parseLog('')).toEqual([]);
    expect(parseLog('{not json')).toEqual([]);
    expect(parseLog('{"id":"a"}')).toEqual([]);
    expect(parseLog(JSON.stringify([a, { id: 1 }, null, { id: 'c', at: 1, min: 0 }]))).toEqual([a]);
  });

  it('appends to an empty or existing log', () => {
    expect(parseLog(appendSession(null, a))).toEqual([a]);
    expect(parseLog(appendSession(JSON.stringify([a]), b))).toEqual([a, b]);
    expect(parseLog(appendSession('oops', b))).toEqual([b]);
  });

  it('removes a session and lowers spent', () => {
    expect(removeSession(JSON.stringify([a, b]), 40, 'a')).toEqual({ time_log: JSON.stringify([b]), spent: 15 });
  });

  it('clears the log and spent at zero, never below', () => {
    expect(removeSession(JSON.stringify([a]), 25, 'a')).toEqual({ time_log: null, spent: null });
    expect(removeSession(JSON.stringify([a]), 10, 'a')).toEqual({ time_log: null, spent: null });
  });

  it('changes nothing for an unknown id', () => {
    expect(removeSession(JSON.stringify([a]), 30, 'x')).toEqual({ time_log: JSON.stringify([a]), spent: 30 });
  });
});
