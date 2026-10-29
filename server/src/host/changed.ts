export function sendWhenChanged<T>(send: (v: T) => void) {
  let last: string | undefined;
  return (v: T) => {
    const next = JSON.stringify(v);
    if (next === last) return;
    last = next;
    send(v);
  };
}
