export const closeKind = (code: number) => (code === 4404 ? 'gone' : 'retry');

const DELAYS = [1000, 2000, 4000, 8000, 10000];

export function backoff() {
  let n = 0;
  return {
    next: () => DELAYS[Math.min(n++, DELAYS.length - 1)],
    reset: () => {
      n = 0;
    },
  };
}
