import { save, stored } from '../../ui/util';

const KEY = 'agentview.boxes';
const KEEP = 300;

let boxes: Record<string, number> | undefined;
const all = () => (boxes ??= stored<Record<string, number>>(KEY, {}));

export const readBox = (id: string, fallback: boolean) => {
  const open = all()[id];
  return open === undefined ? fallback : open === 1;
};

export function saveBox(id: string, open: boolean) {
  const b = all();
  delete b[id];
  b[id] = open ? 1 : 0;
  boxes = Object.fromEntries(Object.entries(b).slice(-KEEP));
  save(KEY, boxes);
}
