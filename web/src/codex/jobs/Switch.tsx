export function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} className={`jb-switch${on ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); onChange(!on); }}><span /></button>;
}
