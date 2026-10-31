import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Icon } from './Icon';

type Native = Omit<ComponentPropsWithRef<'button'>, 'children'>;
type Size = 'sm' | 'md';
type Variant = 'filled' | 'tinted' | 'gray' | 'plain' | 'danger';
type LegacyVariant = 'primary' | 'secondary' | 'quiet';

const variants: Record<LegacyVariant, Variant> = { primary: 'filled', secondary: 'gray', quiet: 'plain' };

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

export function Button({ variant = 'gray', size = 'md', icon, className, type = 'button', children, ...rest }: Native & {
  variant?: Variant | LegacyVariant;
  size?: Size | 'lg';
  icon?: string;
  children?: ReactNode;
}) {
  return (
    <button type={type} className={cx('btn', `btn-${variants[variant as LegacyVariant] ?? variant}`, `btn-${size}`, className)} {...rest}>
      {icon && <Icon name={icon} small />}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, size = 'md', on, small, spin, className, type = 'button', ...rest }: Native & {
  icon: string;
  label: string;
  size?: Size;
  on?: boolean;
  small?: boolean;
  spin?: boolean;
}) {
  return (
    <button type={type} aria-label={label} title={rest.title ?? label} className={cx('icon-btn', `icon-btn-${size}`, on && 'on', className)} {...rest}>
      <Icon name={icon} small={small} spin={spin} />
    </button>
  );
}

export function Chip({ on, late, size = 'md', icon, className, type = 'button', children, ...rest }: Native & {
  on?: boolean;
  late?: boolean;
  size?: Size;
  icon?: string;
  children?: ReactNode;
}) {
  return (
    <button type={type} className={cx('chip', 'chip-btn', size === 'sm' && 'chip-sm', on && 'on', late && 'late', className)} {...rest}>
      {icon && <Icon name={icon} small />}
      {children}
    </button>
  );
}

export const chipClass = ({ on, late }: { on?: boolean; late?: boolean }) => cx('chip', 'chip-btn', on && 'on', late && 'late');
