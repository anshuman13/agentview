import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { setUi, useStore } from '../app/store';
import { useNarrow } from '../app/shell/useNarrow';
import { useThemeName } from '../app/theme';
import { Back } from '../app/touch/back';
import { Button, Chip, IconButton, ShowAll } from '../ui/Button';
import { Menu, MenuItem } from '../ui/Menu';
import { EmptyState } from '../ui/Panel';
import { Card, CardGrid } from '../ui/Card';
import { Section } from '../ui/Section';
import { Skeleton } from '../ui/Skeleton';
import { showChat } from '../ui/util';
import { ago } from '../ui/util';
import { sketchDoc, sketchOpenable, sketchTitle, type SketchTheme } from '../../../shared/sketches';
import { CopyPathItems } from './CopyPathItems';
import type { SketchFile } from './fileApi';
import { useSketch, useSketches } from './useSketches';

export type Device = 'desktop' | 'phone';

const FOLD = 5;
const SIZE: Record<Device, [number, number]> = { desktop: [1280, 800], phone: [390, 844] };

export function SketchList({ sketches, onOpen, zoomed }: { sketches: SketchFile[]; onOpen: (name: string) => void; zoomed?: string | null }) {
  const [all, setAll] = useState(false);
  const theme = useThemeName();
  const rows = all ? sketches : sketches.slice(0, FOLD);
  return (
    <>
      <Section label="Sketches" count={sketches.length} />
      <CardGrid className="sk-grid">
        {rows.map((s) => <Card key={s.name} className="sk-card" cover={<SketchThumb file={s} theme={theme} />} title={sketchTitle(s.name)} meta={ago(s.mtime, ' ago')} style={s.name === zoomed ? { viewTransitionName: ZOOM } : undefined} onClick={() => onOpen(s.name)} />)}
      </CardGrid>
      {rows.length < sketches.length && <ShowAll count={sketches.length} className="ov-more" onClick={() => setAll(true)} />}
    </>
  );
}

// The card's preview loads only once the card scrolls into view, so a long folder reads one file per visible card.
function SketchThumb({ file, theme }: { file: SketchFile; theme: SketchTheme }) {
  const box = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const size = new ResizeObserver(() => setWidth(el.clientWidth));
    size.observe(el);
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return () => size.disconnect();
    }
    const view = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { setSeen(true); view.disconnect(); } }, { rootMargin: '200px' });
    view.observe(el);
    return () => { size.disconnect(); view.disconnect(); };
  }, []);
  return <span className="sk-thumb" ref={box}>{seen && width > 0 && <ThumbFrame file={file} theme={theme} scale={width / SIZE.desktop[0]} />}</span>;
}

export function ThumbFrame({ file, theme, scale }: { file: SketchFile; theme: SketchTheme; scale: number }) {
  const { html, problem } = useSketch(file.path);
  if (html === null || problem) return null;
  const [w, h] = SIZE.desktop;
  return <iframe sandbox="" srcDoc={sketchDoc(html, theme)} title={file.name} tabIndex={-1} aria-hidden="true" style={{ width: w, height: h, transform: `scale(${scale})` }} />;
}

const ZOOM = 'sk-zoom';

// The opened card and the sketch view share one view-transition name, so the card zooms into the view and back out.
// Without the View Transitions API, or with reduced motion, the switch is instant.
function zoom(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return update();
  doc.startViewTransition(() => flushSync(update));
}

const newSketch = () => {
  showChat();
  window.dispatchEvent(new CustomEvent('agentview:insert', { detail: { text: '/sketch ' } }));
};

// The sketch runs in a frame with no scripts and no access to this origin, scaled down to the pane.
// `fitWidth` scales to the stage's width only, for a stage that grows with the frame (a sheet that scrolls).
export function SketchFrame({ name, html, device, theme, fitWidth }: { name: string; html: string; device: Device; theme: SketchTheme; fitWidth?: boolean }) {
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const watch = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const [w, h] = SIZE[device];
  const scale = box.w ? Math.min(1, box.w / w, device === 'phone' && !fitWidth ? box.h / h : 1) : 1;
  // A desktop frame fills the pane's height, so a long sketch scrolls inside it instead of ending halfway down the pane.
  const tall = device === 'desktop' && !fitWidth && box.h ? Math.max(h, Math.floor(box.h / scale)) : h;
  return (
    <div className="sk-stage" ref={stage}>
      <div className={`sk-device sk-${device}`} style={{ width: w * scale, height: tall * scale }}>
        <iframe sandbox="" srcDoc={sketchDoc(html, theme)} title={name} style={{ width: w, height: tall, transform: `scale(${scale})` }} />
      </div>
    </div>
  );
}

function SketchView({ file, device, theme, onDevice, onTheme, onBack }: { file: SketchFile; device: Device; theme: SketchTheme; onDevice: (d: Device) => void; onTheme: (t: SketchTheme) => void; onBack: () => void }) {
  const cwd = useStore((s) => s.session.cwd);
  const { html, problem, reload } = useSketch(file.path);
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const narrow = useNarrow();
  return (
    <div className="sk-view" style={{ viewTransitionName: ZOOM }}>
      <div className="bd-head sk-head">
        <Back close={onBack} />
        {!narrow && <IconButton icon="arrow-left" label="Back" onClick={onBack} />}
        <h2 className="bd-title">{sketchTitle(file.name)}</h2>
        <span className="sk-pick">
          {(['desktop', 'phone'] as const).map((d) => <Chip key={d} size="sm" on={device === d} onClick={() => onDevice(d)}>{d === 'desktop' ? 'Desktop' : 'Phone'}</Chip>)}
        </span>
        <span className="sk-pick">
          {(['light', 'dark'] as const).map((t) => <Chip key={t} size="sm" on={theme === t} onClick={() => onTheme(t)}>{t === 'light' ? 'Light' : 'Dark'}</Chip>)}
        </span>
        <span className="ov-more">
          <IconButton ref={more} size="sm" icon="kebab-vertical" label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
          {menu && (
            <Menu trigger={more} onClose={() => setMenu(false)}>
              <MenuItem onClick={() => { setMenu(false); setUi({ openFile: file.path, follow: false }); }}>Open file</MenuItem>
              <CopyPathItems path={file.path} cwd={cwd} onDone={() => setMenu(false)} />
            </Menu>
          )}
        </span>
      </div>
      {problem ? (
        <EmptyState size="sm" title="Could not load the sketch" hint={problem === 'large' ? 'Too large to show' : 'It may have moved. Go back to the list'} action={problem === 'failed' ? <Button size="sm" onClick={reload}>Retry</Button> : undefined} />
      ) : html === null ? (
        <Skeleton />
      ) : (
        <SketchFrame name={file.name} html={html} device={device} theme={theme} />
      )}
    </div>
  );
}

export function Sketches({ shown }: { shown: boolean }) {
  const { data, error, reload } = useSketches(shown);
  const [open, setOpen] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>(useNarrow() ? 'phone' : 'desktop');
  const [theme, setTheme] = useState<SketchTheme>(useThemeName());
  const chat = useStore((s) => s.session.id);
  const want = useStore((s) => s.ui.sketch);
  useEffect(() => setOpen(null), [chat]);
  useEffect(() => {
    if (!want) return;
    setUi({ sketch: null });
    void reload().then((list) => setOpen(list && sketchOpenable(want, list.map((s) => s.name)) ? want : null));
  }, [want, reload]);
  const file = data?.find((s) => s.name === open);
  const scroller = useRef<HTMLDivElement>(null);
  const listTop = useRef(0);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = file ? 0 : listTop.current;
  }, [!!file]);
  const openSketch = (name: string) => {
    listTop.current = scroller.current?.scrollTop ?? 0;
    flushSync(() => setZoomed(name));
    zoom(() => setOpen(name));
  };
  return (
    <div className="wk"><div className="wk-scroll" ref={scroller}><div className={file ? 'mt-page sk-page' : 'mt-page'}>
      {file && <SketchView file={file} device={device} theme={theme} onDevice={setDevice} onTheme={setTheme} onBack={() => zoom(() => setOpen(null))} />}
      {data?.length ? (
        <div style={{ display: file ? 'none' : 'contents' }}><SketchList sketches={data} zoomed={zoomed} onOpen={openSketch} /></div>
      ) : data ? (
        <EmptyState icon="paintcan" title="No sketches yet. Ask for one with /sketch <what>" action={<Button size="sm" onClick={newSketch}>New sketch</Button>} />
      ) : error ? (
        <EmptyState size="sm" icon="paintcan" title="Could not load sketches" hint={error} action={<Button size="sm" onClick={() => void reload()}>Retry</Button>} />
      ) : (
        <Skeleton />
      )}
    </div></div></div>
  );
}
