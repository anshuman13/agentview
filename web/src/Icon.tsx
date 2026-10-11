import '@vscode/codicons/dist/codicon.css';

export function Icon({ name, small, spin }: { name: string; small?: boolean; spin?: boolean }) {
  return <i aria-hidden className={`codicon codicon-${name} icon${small ? ' small' : ''}${spin ? ' codicon-modifier-spin' : ''}`} />;
}
