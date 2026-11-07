export type DigestGroup<R> = { outcome: string; label: string; rows: R[]; open: boolean };

const FOLDED_ROWS = 3;

// A group that is open by default shows every row unless capOpen; a folded one shows the first 3 until Show all.
export const visibleRows = <R>(g: DigestGroup<R>, all: boolean, capOpen = false) => ((g.open && !capOpen) || all ? g.rows : g.rows.slice(0, FOLDED_ROWS));
