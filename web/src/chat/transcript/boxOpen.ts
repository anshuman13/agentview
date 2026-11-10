import { save, stored } from '../../ui/util';

const KEY = 'agentview.boxes';
const KEEP = 300;

export const readBox = (id: string, fallback: boolean) => {
  const open = stored<Record<string, number>>(KEY, {})[id];
  return open === undefined ? fallback : open === 1;
};

export function saveBox(id: string, open: boolean) {
  const boxes = stored<Record<string, number>>(KEY, {});
  delete boxes[id];
  boxes[id] = open ? 1 : 0;
  save(KEY, Object.fromEntries(Object.entries(boxes).slice(-KEEP)));
}
