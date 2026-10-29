export const ROW_WINDOW = 150;

export function windowStart(total: number, shown: number): number {
  return Math.max(0, total - shown);
}

export function revealMore(shown: number, total: number, batch = ROW_WINDOW): number {
  return Math.min(Math.max(total, ROW_WINDOW), shown + batch);
}
