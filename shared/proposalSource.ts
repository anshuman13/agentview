export type ProposalSource = { key: string; label: string };

const NAMED: Record<string, string> = { corrections: 'Draft edits', voice: 'Your voice', people: 'People', you: 'You' };

export const proposalSource = (f: { id: string; added_by: string | null }): ProposalSource | null => {
  if (f.id.startsWith('learn:')) return { key: 'chat', label: 'Chat learning' };
  if (f.id.startsWith('upd:')) return { key: 'update', label: 'Decision update' };
  const by = f.added_by ?? '';
  if (!by) return null;
  if (by.startsWith('faq:')) return { key: by, label: 'Slack FAQ' };
  if (NAMED[by]) return { key: by, label: NAMED[by] };
  if (by.startsWith('slack:')) return { key: 'slack', label: 'Slack' };
  if (by.startsWith('pr:')) return { key: 'pr', label: 'Pull request' };
  return { key: 'agent', label: 'Agent proposal' };
};
