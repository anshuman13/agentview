// Reconnect delay in ms: 1, 2, 4, 8 s then 15 s, each within plus or minus 20%.
export function backoffDelay(attempt: number, rand: () => number = Math.random): number {
  const n = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  const step = n < 4 ? 1000 * 2 ** n : 15_000;
  return step * (1 + (rand() * 2 - 1) * 0.2);
}
