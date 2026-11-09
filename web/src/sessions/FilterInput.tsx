export function FilterInput({ value, set }: { value: string; set: (v: string) => void }) {
  return <input placeholder="Search repos and chats" value={value} onChange={(e) => set(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && set('')} />;
}
