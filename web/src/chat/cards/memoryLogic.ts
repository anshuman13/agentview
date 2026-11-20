import { RETIRE_AFTER } from '../../../../shared/claimAge';
import { similarClaim } from '../../../../shared/claimMatch';
import type { Profile } from '../../codex/data/sync';
import { restatedClaim, type Fact } from '../../codex/data/wiki/wiki';
import { shortDate } from '../../codex/wiki/shared';
import { MEMORY_FILE } from '../transcript/steps';
import { isMemoryIndex } from '../transcript/workFold';

export type MemoryFile = { path: string; name: string; description: string; text: string; editable?: boolean; at: number };

export type MemoryMark = { mark: 'Conflicts' | 'In wiki' | 'Stale'; claim: string };

// What the wiki says of a memory file (never an instruction file or MEMORY.md): Conflicts when it repeats a Memory claim the user rejected,
// else In wiki when a current Memory claim restates it, else Stale when it has not changed in RETIRE_AFTER. Android MemoryLogic.kt memoryMark says the same.
export function memoryMark(file: MemoryFile, facts: Fact[], profile: Profile, now: number): MemoryMark | null {
  if (!MEMORY_FILE.test(file.path) || isMemoryIndex(file.path)) return null;
  const texts = [file.description, file.text].filter(Boolean);
  const rejected = facts.filter((f) => !f.deleted && f.state === 'rejected' && f.profile === profile && !f.page_id).map((f) => ({ text: f.text ?? '' }));
  for (const t of texts) {
    const hit = similarClaim(t, rejected);
    if (hit) return { mark: 'Conflicts', claim: hit.text };
  }
  for (const t of texts) {
    const hit = restatedClaim(t, facts, profile);
    if (hit) return { mark: 'In wiki', claim: hit.text ?? '' };
  }
  return file.at > 0 && now - file.at > RETIRE_AFTER ? { mark: 'Stale', claim: '' } : null;
}

// The claim Move to wiki makes of a memory file: its description, else its body on one line, cut to the Remember limit. Android MemoryLogic.kt memoryClaimText says the same.
export const memoryClaimText = (file: Pick<MemoryFile, 'description' | 'text'>) => (file.description.trim() || file.text.replace(/\s+/g, ' ').trim()).slice(0, 400);

// The mark's long form under the file's source line.
export function markLine(m: MemoryMark, at: number) {
  if (m.mark === 'Conflicts') return `Similar to a claim you rejected: ${m.claim}`;
  if (m.mark === 'In wiki') return `Also in the wiki: ${m.claim}`;
  return `Not changed since ${shortDate(at)}`;
}
