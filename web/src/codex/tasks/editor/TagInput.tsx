// One tag at a time: Enter or space adds it and clears the field, blur adds what is typed and closes, Escape closes.
export function TagInput({ onAdd, onClose }: { onAdd: (tag: string) => void; onClose: () => void }) {
  const tagOf = (el: HTMLInputElement) => el.value.replace(/^#/, '').trim().toLowerCase();
  return (
    <input autoFocus className="as-tag-input" placeholder="Tag" aria-label="New tag" enterKeyHint="done"
      onKeyDown={(e) => {
        const v = tagOf(e.currentTarget);
        if ((e.key === 'Enter' || e.key === ' ') && v) { e.preventDefault(); onAdd(v); e.currentTarget.value = ''; }
        else if (e.key === 'Escape') onClose();
      }}
      onBlur={(e) => { const v = tagOf(e.currentTarget); if (v) onAdd(v); onClose(); }} />
  );
}
