// Spinners and pulsing dots repaint the window every frame; pause them while the window is not in front to save energy.
// Only looping animations pause: a one-shot fade paused at its first frame would leave a snack or page invisible.
let away = false;

export function pauseLoops(list: Animation[]) {
  for (const a of list) {
    if (a.effect?.getTiming().iterations !== Infinity) continue;
    if (away) a.pause();
    else if (a.playState === 'paused') a.play();
  }
}

export function setAway(on: boolean, list: Animation[]) {
  away = on;
  pauseLoops(list);
}

export function watchStill() {
  const still = () => setAway(document.hidden || !document.hasFocus(), document.getAnimations());
  for (const ev of ['focus', 'blur']) window.addEventListener(ev, still);
  document.addEventListener('visibilitychange', still);
  document.addEventListener('animationstart', (e) => { if (away && e.target instanceof Element) pauseLoops(e.target.getAnimations()); });
  still();
}
