import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutputBuffer } from './outputBuffer.js';

describe('OutputBuffer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces chunks into one ordered emit per timer tick', () => {
    const sent: string[] = [];
    const b = new OutputBuffer(100, 10, (d) => sent.push(d));
    b.push('a');
    b.push('b');
    b.push('c');
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(10);
    expect(sent).toEqual(['abc']);
    expect(b.buf).toBe('abc');
  });

  it('flushes pending output on dispose and leaves no timer', () => {
    const sent: string[] = [];
    const b = new OutputBuffer(100, 10, (d) => sent.push(d));
    b.push('x');
    b.dispose();
    expect(sent).toEqual(['x']);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(50);
    expect(sent).toEqual(['x']);
  });

  it('snapshot includes pending output once and is not re-emitted', () => {
    const sent: string[] = [];
    const b = new OutputBuffer(100, 10, (d) => sent.push(d));
    b.push('one');
    expect(b.snapshot()).toBe('one');
    b.push('two');
    vi.advanceTimersByTime(10);
    expect(sent).toEqual(['one', 'two']);
    expect(b.buf).toBe('onetwo');
  });

  it('trims only past 2x max, back to max on a line boundary', () => {
    const b = new OutputBuffer(10, 10, () => {});
    b.push('aaaa\nbbbb\n');
    b.flush();
    b.push('cccc\n');
    b.flush();
    expect(b.buf.length).toBe(15);
    b.push('dddd\nee\n');
    b.flush();
    expect(b.buf).toBe('dddd\nee\n');
  });

  it('trims at max length when no newline follows', () => {
    const b = new OutputBuffer(10, 10, () => {});
    b.push('x'.repeat(25));
    b.flush();
    expect(b.buf).toBe('x'.repeat(10));
  });

  it('clearLine drops everything before the last newline', () => {
    const b = new OutputBuffer(100, 10, () => {});
    b.push('a\nb\npartial');
    b.clearLine();
    expect(b.buf).toBe('partial');
  });
});
