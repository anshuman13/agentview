import { ROW_WINDOW } from '../../../../shared/protocol';

export function windowStart(total: number, shown: number): number {
  return Math.max(0, total - shown);
}

export function hiddenCount(earlier: number, total: number, shown: number): number {
  return earlier + windowStart(total, shown);
}

export const FIRST_ROWS = 30;

export function stageRows(rendered: number, target: number, step = FIRST_ROWS): number {
  return Math.min(target, rendered + step);
}

export function revealMore(shown: number, total: number, batch = ROW_WINDOW): number {
  return Math.min(Math.max(total, ROW_WINDOW), shown + batch);
}

const EARLIER_REPLIES = 3;
const EARLIER_AUTO_PAGES = 3;

// A chat that opens on too few replies loads earlier pages by itself, a few times.
export function needsEarlier(replies: number, earlier: number, autoLoads: number): boolean {
  return replies < EARLIER_REPLIES && earlier > 0 && autoLoads < EARLIER_AUTO_PAGES;
}
