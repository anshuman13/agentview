import { LINE_ICONS } from '../../../shared/lineIcons';

export function Icon({ name, small, spin, color }: { name: string; small?: boolean; spin?: boolean; color?: string }) {
  const line = LINE_ICONS[name];
  const cls = `codicon codicon-${name} icon${small ? ' small' : ''}${spin ? ' codicon-modifier-spin' : ''}`;
  if (line) {
    return (
      <i aria-hidden className={`${cls} line-icon`} style={color ? { color } : undefined}>
        <svg viewBox="0 0 20 20" width="1em" height="1em" fill={line.fill ? 'currentColor' : 'none'} stroke={line.fill ? 'none' : 'currentColor'}>
          <path d={line.d} />
        </svg>
      </i>
    );
  }
  return <i aria-hidden className={cls} style={color ? { color } : undefined} />;
}
