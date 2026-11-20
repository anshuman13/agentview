// The text an edited claim saves: trimmed, null when blank or unchanged.
export const editedClaimText = (old: string | null | undefined, next: string): string | null => {
  const text = next.trim();
  return text && text !== old ? text : null;
};
