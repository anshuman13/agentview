import type { ComponentPropsWithRef, MouseEventHandler, ReactNode } from 'react';
import { Icon } from './Icon';
import { cx } from './util';

type Native = Omit<ComponentPropsWithRef<'button'>, 'children'>;
type Size = 'sm' | 'md';
type Variant = 'filled' | 'tinted' | 'gray' | 'plain' | 'danger';
type LegacyVariant = 'primary' | 'secondary' | 'quiet';
type Tone = 'work' | 'personal' | 'accent';

const variants: Record<LegacyVariant, Variant> = { primary: 'filled', secondary: 'gray', quiet: 'plain' };

export const buttonClass = ({ variant = 'gray', size = 'md' }: { variant?: Variant | LegacyVariant; size?: Size | 'lg' }) => cx('btn', `btn-${variants[variant as LegacyVariant] ?? variant}`, `btn-${size}`);

export function Button({ variant, size, icon, className, type = 'button', href, target, rel, children, ...rest }: Native & {
  variant?: Variant | LegacyVariant;
  size?: Size | 'lg';
  icon?: string;
  href?: string;
  target?: string;
  rel?: string;
  children?: ReactNode;
}) {
  const cls = cx(buttonClass({ variant, size }), className);
  const body = <>{icon && <Icon name={icon} small />}{children}</>;
  if (href) return <a className={cls} href={href} target={target} rel={rel} title={rest.title} aria-label={rest['aria-label']} onClick={rest.onClick as MouseEventHandler<HTMLElement>}>{body}</a>;
  return <button type={type} className={cls} {...rest}>{body}</button>;
}

export function ShowToggle({ open, count, onClick }: { open?: boolean; count?: number; onClick: () => void }) {
  return <Button variant="quiet" size="sm" className="show-toggle" onClick={onClick}>{open ? 'Show less' : count ? `Show more (${count})` : 'Show more'}</Button>;
}

export function IconButton({ icon, label, size = 'md', on, small, spin, className, type = 'button', href, ...rest }: Native & {
  icon: string;
  label: string;
  size?: Size;
  on?: boolean;
  small?: boolean;
  spin?: boolean;
  href?: string;
}) {
  const cls = cx('icon-btn', `icon-btn-${size}`, on && 'on', className);
  const title = rest.title ?? label;
  const glyph = <Icon name={icon} small={small} spin={spin} />;
  if (href) return <a className={cls} href={href} target="_blank" rel="noreferrer" title={title} aria-label={label}>{glyph}</a>;
  return <button type={type} aria-label={label} title={title} className={cls} {...rest}>{glyph}</button>;
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
