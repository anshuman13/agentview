import { useRef, useState, type ReactNode } from 'react';
import { Guard } from '../app/Guard';
import { THEME_NAMES, useTheme } from '../app/theme';
import { AskRow } from '../ui/AskRow';
import { Button, Chip, IconButton } from '../ui/Button';
import { Menu, MenuItem, MenuSeparator } from '../ui/Menu';
import { EmptyState, Panel } from '../ui/Panel';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';

const sizes = ['sm', 'md', 'lg'] as const;
const variants = ['filled', 'tinted', 'gray', 'plain', 'danger'] as const;

function Story({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ds-story">
      <div className="ds-label">{label}</div>
      <div className="ds-cases">{children}</div>
    </div>
  );
}

function Block({ name, children }: { name: string; children: ReactNode }) {
  return (
    <Guard retry>
      <Section label={name} />
      <div className="ds-block">{children}</div>
    </Guard>
  );
}

function MenuStory() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div className="ds-anchor">
      <Button ref={trigger} icon="ellipsis" onClick={() => setOpen(!open)}>Open menu</Button>
      {open && (
        <Menu trigger={trigger} onClose={() => setOpen(false)}>
          <MenuItem>Plain</MenuItem>
          <MenuItem icon="edit">With icon</MenuItem>
          <MenuItem href="https://example.com">Link</MenuItem>
          <MenuSeparator />
          <MenuItem icon="trash" danger>Danger</MenuItem>
        </Menu>
      )}
    </div>
  );
}

function SectionStory() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Story label="plain"><Section label="Today" /></Story>
      <Story label="count"><Section label="Today" count={4} /></Story>
      <Story label="action"><Section label="Today" action={<Button size="sm" variant="plain">Add</Button>} /></Story>
      <Story label="collapsible open"><Section label="Today" count={2} open onToggle={() => {}} /></Story>
      <Story label="collapsible closed"><Section label="Earlier" count={2} open={false} onToggle={() => {}} /></Story>
      <Story label="collapsible, toggles"><Section label="Today" open={open} onToggle={() => setOpen(!open)} /></Story>
      <Story label="sticky header in a scroll container">
        <div className="ds-scroll">
          <Section label="Sticky" count={6} />
          {[1, 2, 3, 4, 5, 6].map((n) => <Row key={n} title={`Row ${n}`} meta="Sample" />)}
        </div>
      </Story>
    </>
  );
}

function Stories() {
  return (
    <>
      <Block name="Button">
        {sizes.map((size) => (
          <Story key={size} label={size}>
            {variants.map((variant) => <Button key={variant} variant={variant} size={size}>{variant}</Button>)}
            <Button size={size} icon="add">With icon</Button>
            <Button size={size} disabled>Disabled</Button>
            <Button size={size} variant="primary">primary</Button>
            <Button size={size} variant="secondary">secondary</Button>
            <Button size={size} variant="quiet">quiet</Button>
          </Story>
        ))}
      </Block>
      <Block name="IconButton">
        {(['sm', 'md'] as const).map((size) => (
          <Story key={size} label={size}>
            <IconButton icon="settings-gear" label="Default" size={size} />
            <IconButton icon="settings-gear" label="On" size={size} on />
            <IconButton icon="settings-gear" label="Disabled" size={size} disabled />
            <IconButton icon="refresh" label="Spin" size={size} spin />
            <IconButton icon="link-external" label="Link" size={size} href="https://example.com" />
          </Story>
        ))}
      </Block>
      <Block name="Chip">
        {(['md', 'sm'] as const).map((size) => (
          <Story key={size} label={size}>
            <Chip size={size}>Default</Chip>
            <Chip size={size} on>On</Chip>
            <Chip size={size} late>Late</Chip>
            <Chip size={size} tone="work">Work</Chip>
            <Chip size={size} tone="personal">Personal</Chip>
            <Chip size={size} tone="accent">Accent</Chip>
            <Chip size={size} quiet>Quiet</Chip>
            <Chip size={size} icon="tag">With icon</Chip>
            <Chip size={size} href="https://example.com">Link</Chip>
          </Story>
        ))}
        <Story label="static tag"><span className="chip">Tag</span></Story>
      </Block>
      <Block name="Field">
        <Story label="text input"><input aria-label="Text" /></Story>
        <Story label="with value"><input aria-label="Value" defaultValue="Sample value" /></Story>
        <Story label="placeholder"><input aria-label="Placeholder" placeholder="Placeholder" /></Story>
        <Story label="disabled"><input aria-label="Disabled" defaultValue="Disabled" disabled /></Story>
        <Story label="textarea"><textarea aria-label="Textarea" rows={3} defaultValue="Sample text" /></Story>
        <Story label="textarea placeholder"><textarea aria-label="Textarea placeholder" rows={3} placeholder="Placeholder" /></Story>
      </Block>
      <Block name="Menu">
        <Story label="trigger, sheet on phone width"><MenuStory /></Story>
      </Block>
      <Block name="Row">
        <Panel padding="sm">
          <Row title="Button row" meta="Sample" />
          <Row href="https://example.com" title="Link row" meta="Opens a link" />
          <Row plain title="Plain row" meta="Not interactive" />
          <Row title="With action" meta="Sample" action={<IconButton icon="ellipsis" label="More" />} />
          <Row leading="A" title="Leading, meta and trailing" meta="Sample" trailing={<span className="badge quiet">3</span>} />
          <Row lines={2} title="Two lines of title text that wraps onto a second line when it is long enough to need one" meta="Sample" />
          <Row title="A long title that ellipsises when it is longer than the width of the row it sits in, however wide that is" meta="Sample" />
        </Panel>
      </Block>
      <Block name="AskRow">
        <Panel padding="sm">
          <AskRow title="No actions" meta="Sample" />
          <AskRow title="One action" meta="Sample" actions={<Button size="sm" variant="filled">Approve</Button>} />
          <AskRow title="Primary and More" meta="Sample" actions={<><Button size="sm" variant="filled">Approve</Button><IconButton icon="ellipsis" label="More" /></>} />
        </Panel>
      </Block>
      <Block name="Panel">
        <Panel title="Title" action={<Button size="sm" variant="plain">Action</Button>}>Padding md</Panel>
        <Panel padding="sm" title="Title">Padding sm</Panel>
        <Panel>No title</Panel>
        <Panel padding="sm">No title, padding sm</Panel>
      </Block>
      <Block name="Badge">
        <Story label="neutral"><span className="badge">3</span></Story>
        <Story label="quiet"><span className="badge quiet">3</span></Story>
        <Story label="waiting"><span className="badge waiting">3</span></Story>
        <Story label="running with dot"><span className="badge running">Running</span></Story>
      </Block>
      <Block name="EmptyState">
        <Panel><EmptyState icon="inbox" title="No items" hint="Items you add show up here" action={<Button size="sm">Add item</Button>} /></Panel>
        <Panel><EmptyState title="No items" /></Panel>
        <Panel><EmptyState size="sm" icon="inbox" title="No items" hint="Items you add show up here" action={<Button size="sm">Add item</Button>} /></Panel>
        <Panel><EmptyState size="sm" title="No items" /></Panel>
      </Block>
      <Block name="Section"><SectionStory /></Block>
    </>
  );
}

export function DesignPage() {
  const bare = new URLSearchParams(location.search).has('bare');
  const [theme, toggle] = useTheme();
  const [phone, setPhone] = useState(false);
  return (
    <div className="ds-page">
      {!bare && (
        <div className="ds-toolbar">
          <Chip on={theme === 'light'} onClick={toggle}>{THEME_NAMES[theme]}</Chip>
          <Chip on={!phone} onClick={() => setPhone(false)}>Desktop</Chip>
          <Chip on={phone} onClick={() => setPhone(true)}>Phone</Chip>
        </div>
      )}
      {phone && !bare ? <iframe key={theme} className="ds-phone" title="Phone width" src="/design?bare" /> : <Stories />}
    </div>
  );
}
