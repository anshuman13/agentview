// The claims still open, in review order: skipped ones go to the back, in the order they were skipped.
export function reviewQueue(order: string[], skipped: string[], open: ReadonlySet<string>) {
  const left = order.filter((k) => open.has(k));
  return [...left.filter((k) => !skipped.includes(k)), ...skipped.filter((k) => open.has(k))];
}
