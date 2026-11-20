import { describe, expect, it } from 'bun:test';
import { unmadeActions } from './noteActions';

const same = (t: string) => t;

describe('unmadeActions', () => {
  it('takes unticked lines with either bullet and skips ticked and plain ones', () => {
    const notes = '- [ ] send deck\n* [ ] call Ann\n- [x] done already\n- [X] done too\nplain line\n  - [ ] indented\n- [ ]\n- [ ]   ';
    expect(unmadeActions(notes, [], same)).toEqual(['send deck', 'call Ann', 'indented']);
  });

  it('skips lines whose normalized title is already an action', () => {
    expect(unmadeActions('- [ ] Send the deck!\n- [ ] book room', ['send  the DECK'], same)).toEqual(['book room']);
  });

  it('matches after the due date is stripped and offers a repeated line once', () => {
    const strip = (t: string) => t.replace(/ friday$/, '');
    expect(unmadeActions('- [ ] send deck friday\n- [ ] ping Bo friday\n- [ ] ping Bo', ['send deck'], strip)).toEqual(['ping Bo friday']);
  });
});
