import { describe, expect, it } from 'bun:test';
import { setAway } from './stillLoops';

const anim = (iterations: number) => {
  const a = { playState: 'running', effect: { getTiming: () => ({ iterations }) }, pause() { a.playState = 'paused'; }, play() { a.playState = 'running'; } };
  return a;
};

describe('setAway', () => {
  it('pauses only looping animations while away and resumes them on return', () => {
    const spin = anim(Infinity);
    const fade = anim(1);
    const list = [spin, fade] as unknown as Animation[];
    setAway(true, list);
    expect([spin.playState, fade.playState]).toEqual(['paused', 'running']);
    setAway(false, list);
    expect([spin.playState, fade.playState]).toEqual(['running', 'running']);
  });
});
