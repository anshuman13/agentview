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

type Link = { id: string; profile: string; deleted?: number | boolean; state?: string | null; superseded_by?: string | null };

// The current claim a proposal that replaces id should supersede: id itself, or the claim at the end of its superseded_by chain.
// A link to a claim that is not live is not followed, as in currentClaim. Null when id is not live, and on a loop.
export function replaceTarget(facts: Link[], id: string, profile: string): string | null {
  const alive = (at: string) => {
    const f = facts.find((x) => x.id === at && x.profile === profile);
    return f && !f.deleted && (f.state ?? 'live') === 'live' ? f : undefined;
  };
  const seen = new Set<string>();
  let f = alive(id);
  while (f && !seen.has(f.id)) {
    seen.add(f.id);
    const next = f.superseded_by ? alive(f.superseded_by) : undefined;
    if (!next) return f.id;
    f = next;
  }
  return null;
}
