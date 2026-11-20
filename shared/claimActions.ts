export type ClaimButton = 'reject' | 'approve' | 'confirm' | 'more';
export type ClaimMenuItem = 'edit' | 'cite' | 'contest' | 'resolve' | 'retire' | 'restore';

// At most two controls per claim row. Stale wins over proposed, proposed over the menu; a proposed claim has no menu.
export function claimActions(state: string | null | undefined, contested: boolean, { stale = false, editing = false, contesting = false } = {}): { buttons: ClaimButton[]; menu: ClaimMenuItem[] } {
  const menu: ClaimMenuItem[] = [];
  if (!editing) menu.push('edit');
  menu.push('cite');
  if (!contested && !contesting) menu.push('contest');
  if (contested) menu.push('resolve');
  menu.push(state === 'retired' ? 'restore' : 'retire');
  if (stale) return { buttons: ['confirm', 'more'], menu };
  if (state === 'proposed') return { buttons: ['reject', 'approve'], menu: [] };
  return { buttons: ['more'], menu };
}
