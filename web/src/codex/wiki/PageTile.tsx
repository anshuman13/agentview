import type { Page } from '../data/wiki';
import { Icon } from '../../ui/Icon';

// Each page gets a coloured tile, picked from its id so it stays put; the section picks the icon.
const TILES = ['emerald', 'violet', 'blue', 'amber', 'rose', 'sky'];
const SECTION_ICON: Record<string, string> = { Company: 'organization', Directory: 'person', Domain: 'symbol-namespace' };
export function PageTile({ page }: { page: Page }) {
  let h = 0;
  for (const ch of page.id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return <span className={`wk-tile ${TILES[Math.abs(h) % TILES.length]}`}><Icon name={SECTION_ICON[page.section ?? ''] ?? 'file'} /></span>;
}
