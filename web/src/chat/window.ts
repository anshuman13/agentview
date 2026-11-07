import { ROW_WINDOW } from '../../../shared/protocol';

export function windowStart(total: number, shown: number): number {
  return Math.max(0, total - shown);
}

export function hiddenCount(earlier: number, total: number, shown: number): number {
  return earlier + windowStart(total, shown);
}

export function revealMore(shown: number, total: number, batch = ROW_WINDOW): number {
  return Math.min(Math.max(total, ROW_WINDOW), shown + batch);
}
