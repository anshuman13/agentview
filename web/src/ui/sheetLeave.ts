// A sheet or menu sheet that unmounts leaves a copy of itself that slides out, so every close animates.
// A sheet that mounts in the same commit (a swap or a Back to a parent sheet) cancels the copy.
let fresh: (() => void)[] = [];
const FALLBACK_MS = 600;

export function leaveCopy(nodes: (HTMLElement | null)[]) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const copies = nodes.filter((n): n is HTMLElement => !!n?.isConnected).map((n) => {
    const c = n.cloneNode(true) as HTMLElement;
    c.classList.add('sheet-leaving');
    c.setAttribute('aria-hidden', 'true');
    n.before(c);
    return c;
  });
  if (!copies.length) return;
  const remove = () => copies.forEach((c) => c.remove());
  copies[0].addEventListener('animationend', (e) => { if (e.target === copies[0]) remove(); });
  setTimeout(remove, FALLBACK_MS);
  fresh.push(remove);
  queueMicrotask(() => { fresh = fresh.filter((r) => r !== remove); });
}

export function cancelLeaving() {
  fresh.forEach((r) => r());
  fresh = [];
}
