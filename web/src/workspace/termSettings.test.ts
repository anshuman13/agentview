import { describe, expect, it } from 'bun:test';
import { parseTermSettings } from './termSettings';

describe('parseTermSettings', () => {
  it('defaults when unset or broken', () => {
    expect(parseTermSettings(null)).toEqual({ copyOnSelect: false, scrollback: 5000 });
    expect(parseTermSettings('{')).toEqual({ copyOnSelect: false, scrollback: 5000 });
  });
  it('keeps known values and drops unknown scrollback sizes', () => {
    expect(parseTermSettings('{"copyOnSelect":true,"scrollback":10000}')).toEqual({ copyOnSelect: true, scrollback: 10000 });
    expect(parseTermSettings('{"copyOnSelect":"yes","scrollback":123}')).toEqual({ copyOnSelect: false, scrollback: 5000 });
  });
});
