import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Guard } from '../app/Guard';
import { THEME_NAMES, applyTheme, useTheme, useThemeName } from '../app/theme';
import { SnackBar } from '../codex/SnackBar';
import { copyText } from '../codex/view';
import { AskRow } from '../ui/AskRow';
import { Badge } from '../ui/Badge';
import { Button, Chip, IconButton } from '../ui/Button';
import { Menu, MenuItem, MenuSeparator } from '../ui/Menu';
import { EmptyState, Panel } from '../ui/Panel';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { Sheet } from '../ui/Sheet';
import { blockLink, designSearch, parseDesignQuery, type Width } from './url';

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

const replaceUrl = (search: string, hash = location.hash) => history.replaceState(null, '', `${location.pathname}${search}${hash}`);

function Block({ name, children }: { name: string; children: ReactNode }) {
  const theme = useThemeName();
  const id = name.toLowerCase();
  const copyLink = () => {
    const { bare, width } = parseDesignQuery(location.search);
    replaceUrl(location.search, `#${id}`);
    copyText(blockLink(location.origin, location.search, id, theme, bare ? 'phone' : width));
  };
  return (
    <Guard retry>
      <div id={id} className="ds-block-anchor">
        <Section label={name} action={<IconButton icon="link" label={`Copy link to ${name}`} size="sm" onClick={copyLink} />} />
        <div className="ds-block">{children}</div>
      </div>
    </Guard>
  );
}

function SheetStory() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open sheet</Button>
      {open && (
        <Sheet label="Sample sheet" onClose={() => setOpen(false)}>
          <Section label="Sample" />
          <div className="as-group">
            <Row plain title="First row" meta="Sample" />
            <Row plain title="Second row" meta="Sample" />
            <Row plain title="Third row" meta="Sample" />
          </div>
        </Sheet>
      )}
    </>
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
      <Story label="focused"><div className="ds-focus"><Section label="Today" count={2} open onToggle={() => {}} /></div></Story>
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
  useEffect(() => { document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView(); }, []);
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
        <Story label="focused"><div className="ds-focus ds-cases">{variants.map((variant) => <Button key={variant} variant={variant}>{variant}</Button>)}</div></Story>
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
        <Story label="focused"><div className="ds-focus ds-cases"><IconButton icon="settings-gear" label="Button" /><IconButton icon="link-external" label="Link" href="https://example.com" /></div></Story>
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
        <Story label="focused"><div className="ds-focus ds-cases"><Chip>Button</Chip><Chip href="https://example.com">Link</Chip></div></Story>
        <Story label="static tag"><span className="chip">Tag</span></Story>
      </Block>
      <Block name="Field">
        <Story label="text input"><input aria-label="Text" /></Story>
        <Story label="with value"><input aria-label="Value" defaultValue="Sample value" /></Story>
        <Story label="placeholder"><input aria-label="Placeholder" placeholder="Placeholder" /></Story>
        <Story label="disabled"><input aria-label="Disabled" defaultValue="Disabled" disabled /></Story>
        <Story label="textarea"><textarea aria-label="Textarea" rows={3} defaultValue="Sample text" /></Story>
        <Story label="textarea placeholder"><textarea aria-label="Textarea placeholder" rows={3} placeholder="Placeholder" /></Story>
        <Story label="focused"><div className="ds-focus ds-cases"><input aria-label="Focused text" defaultValue="Text" /><textarea aria-label="Focused textarea" rows={3} defaultValue="Text" /><select aria-label="Focused select"><option>Option</option></select></div></Story>
      </Block>
      <Block name="Menu">
        <Story label="trigger, sheet on phone width"><MenuStory /></Story>
        <Story label="focused"><div className="ds-focus"><MenuItem>Focused item</MenuItem></div></Story>
      </Block>
      <Block name="Sheet">
        <Story label="trigger, closes on Escape, Back or backdrop"><SheetStory /></Story>
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
        <Story label="focused"><Panel padding="sm"><div className="ds-focus"><Row title="Focused row" meta="Sample" /></div></Panel></Story>
      </Block>
      <Block name="AskRow">
        <Panel padding="sm">
          <AskRow title="No actions" meta="Sample" />
          <AskRow title="One action" meta="Sample" actions={<Button size="sm" variant="filled">Approve</Button>} />
          <AskRow title="Primary and More" meta="Sample" actions={<><Button size="sm" variant="filled">Approve</Button><IconButton icon="ellipsis" label="More" /></>} />
        </Panel>
        <Story label="focused"><Panel padding="sm"><div className="ds-focus"><AskRow title="Focused row" meta="Sample" /></div></Panel></Story>
      </Block>
      <Block name="Panel">
        <Panel title="Title" action={<Button size="sm" variant="plain">Action</Button>}>Padding md</Panel>
        <Panel padding="sm" title="Title">Padding sm</Panel>
        <Panel>No title</Panel>
        <Panel padding="sm">No title, padding sm</Panel>
      </Block>
      <Block name="Badge">
        {(['waiting', 'sent', 'skipped', 'failed', 'done', 'late', 'new'] as const).map((status) => <Story key={status} label={status}><Badge status={status} /></Story>)}
        <Story label="needs you"><Badge status="waiting" label="Needs you" /></Story>
        <Story label="count"><Badge status="failed" count={2} /></Story>
        <Story label="digits, neutral"><span className="badge">3</span></Story>
        <Story label="digits, quiet"><span className="badge quiet">3</span></Story>
        <Story label="running with dot"><Badge status="running" /></Story>
        <Story label="live"><Badge status="running" label="Live" /></Story>
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
  const query = parseDesignQuery(location.search);
  const [theme, toggle] = useTheme();
  const [width, setWidth] = useState<Width>(query.width);
  useEffect(() => { if (query.theme) applyTheme(query.theme); }, []);
  const phone = width === 'phone';
  const pick = (w: Width) => {
    setWidth(w);
    replaceUrl(designSearch(location.search, { width: w }));
  };
  const toggleTheme = () => {
    toggle();
    replaceUrl(designSearch(location.search, { theme: document.documentElement.dataset.theme as typeof theme }));
  };
  return (
    <div className="ds-page">
      {!query.bare && (
        <div className="ds-toolbar">
          <Chip on={theme === 'light'} onClick={toggleTheme}>{THEME_NAMES[theme]}</Chip>
          <Chip on={!phone} onClick={() => pick('desktop')}>Desktop</Chip>
          <Chip on={phone} onClick={() => pick('phone')}>Phone</Chip>
        </div>
      )}
      {phone && !query.bare ? <iframe key={`${theme}${location.hash}`} className="ds-phone" title="Phone width" src={`/design?bare&theme=${theme}${location.hash}`} /> : <Stories />}
      <SnackBar />
    </div>
  );
}
