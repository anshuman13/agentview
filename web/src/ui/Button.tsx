import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Icon } from './Icon';

type Native = Omit<ComponentPropsWithRef<'button'>, 'children'>;
type Size = 'sm' | 'md';
type Variant = 'filled' | 'tinted' | 'gray' | 'plain' | 'danger';
type LegacyVariant = 'primary' | 'secondary' | 'quiet';
type Tone = 'work' | 'personal' | 'accent';

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

export function Chip({ on, late, tone, quiet, size = 'md', icon, className, type = 'button', href, target, rel, children, ...rest }: Native & {
  on?: boolean;
  late?: boolean;
  tone?: Tone;
  quiet?: boolean;
  size?: Size;
  icon?: string;
  href?: string;
  target?: string;
  rel?: string;
  children?: ReactNode;
}) {
  const cls = cx('chip', 'chip-btn', size === 'sm' && 'chip-sm', on && 'on', late && 'late', tone && `chip-${tone}`, quiet && 'chip-quiet', className);
  const body = <>{icon && <Icon name={icon} small />}{children}</>;
  if (href) return <a className={cls} href={href} target={target} rel={rel} title={rest.title} aria-label={rest['aria-label']}>{body}</a>;
  return <button type={type} className={cls} {...rest}>{body}</button>;
}

export const chipClass = ({ on, late, tone, quiet }: { on?: boolean; late?: boolean; tone?: Tone; quiet?: boolean }) => cx('chip', 'chip-btn', on && 'on', late && 'late', tone && `chip-${tone}`, quiet && 'chip-quiet');
