import { useEffect, useMemo, useRef, useState } from 'react';
import { setUi, useStore } from '../store';
import { isDocPath } from '../../workspace/fileApi';
import type { SavedSession } from '../../../../shared/protocol';
import { providerModes } from '../../../../shared/providers';
import { Back } from '../touch/back';
import { effortsFor, modelsFor } from '../../chat/capabilitiesLogic';
import { useCan } from '../../chat/useCan';
import { openSearch, useView } from '../../codex/view';
import { assistantStore } from '../../codex/data';
import { PINS_URL, get } from '../../sessions/folders';
import { command, listKeys, save, storedStrings } from '../../ui/util';
import { ITEMS_KEY, KEY, MAX_RECENT_ITEMS, MAX_ROWS, buildCommands, itemKey, paletteItems, pinCommands, rankCommands, rankItems, recentItems, remember, seeAllCount, type Command, type PaletteItem } from './paletteLogic';
import { openItem, perform } from './paletteActions';
import { appSettings } from '../appSettings';
import { PaletteEntries, type Entry } from './PaletteEntries';

export function Palette() {
  const models = modelsFor(useStore((s) => s.session.models), useStore((s) => s.session.capabilities));
  const model = useStore((s) => s.session.model);
  const provider = useStore((s) => s.session.provider);
  const canEffort = useCan('effort');
  const efforts = useMemo(() => (canEffort ? effortsFor(models, model) : []), [canEffort, models, model]);
  const modes = useMemo(() => providerModes(provider), [provider]);
  const live = useStore((s) => s.live);
  const [fetched, setFetched] = useState<{ pins: string[]; saved: SavedSession[] }>({ pins: [], saved: [] });
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const [recent, setRecent] = useState(() => storedStrings(KEY));
  const [recentOpened, setRecentOpened] = useState(() => storedStrings(ITEMS_KEY));
  const list = useRef<HTMLUListElement>(null);
  const deploy = appSettings.use((s) => s.deploy);
  const doc = useStore((s) => isDocPath(s.ui.openFile ?? ''));
  const providers = appSettings.use((s) => s.providers);
  const hidden = appSettings.use((s) => s.hiddenFeatures);
  const pinned = useMemo(() => pinCommands(fetched.pins, live, fetched.saved), [fetched, live]);
  const commands = useMemo(() => [...pinned, ...buildCommands(models, deploy, efforts, providers, modes, doc, hidden)], [pinned, models, deploy, efforts, providers, modes, doc, hidden]);
  const rows = useMemo(() => rankCommands(commands, q, recent, MAX_ROWS + pinned.length), [commands, pinned, q, recent]);

  const items = useMemo(() => (open ? paletteItems(assistantStore().snapshot()) : []), [open]);
  const blank = !q.trim();
  const itemRows = useMemo(() => (blank ? recentItems(items, recentOpened) : rankItems(items, q, recentOpened)), [items, q, blank, recentOpened]);
  const { filter } = useView();
  const total = useMemo(() => {
    const snap = assistantStore().snapshot();
    return open && !blank && snap.phase === 'ready' ? seeAllCount(snap, filter, q) : 0;
  }, [open, blank, filter, q]);
  const all: Entry[] = total > 0 ? [{ all: total }] : [];
  const entries: Entry[] = blank
    ? [...itemRows.map((h) => ({ item: h })), ...rows.map((r) => ({ row: r }))]
    : [...rows.map((r) => ({ row: r })), ...itemRows.map((h) => ({ item: h })), ...all];

  useEffect(() => {
    if (!open) return;
    let stale = false;
    setFetched({ pins: [], saved: [] });
    void Promise.all([get(PINS_URL), get('/api/sessions')]).then(([pins, saved]) => !stale && pins && setFetched({ pins, saved: saved ?? [] }));
    return () => { stale = true; };
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p';
      if (!combo && e.key !== 'F1') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen((v) => !v);
      setQ('');
      setIdx(0);
      setUi({ switcherOpen: false, repoPicker: false });
    };
    const onOpen = () => { setOpen(true); setQ(''); setIdx(0); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('agentview:palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('agentview:palette', onOpen);
    };
  }, []);

  useEffect(() => {
    list.current?.children[idx]?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  if (!open) return null;

  const close = () => setOpen(false);
  const run = (cmd: Command) => {
    if (!cmd.pinned) {
      const next = remember(recent, cmd.id);
      setRecent(next);
      save(KEY, next);
    }
    close();
    perform(cmd.id);
  };

  const runItem = (i: PaletteItem) => {
    const next = remember(recentOpened, itemKey(i), MAX_RECENT_ITEMS);
    setRecentOpened(next);
    save(ITEMS_KEY, next);
    close();
    openItem(i);
  };
  const runAll = () => {
    close();
    openSearch(q);
    command('assistant');
  };
  const enter = (e?: Entry) => e && ('row' in e ? run(e.row.cmd) : 'all' in e ? runAll() : runItem(e.item.item));

  return (
    <div className="overlay" onClick={close}>
      <Back close={close} />
      <div className="palette" role="dialog" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <span className="palette-prefix">&gt;</span>
          <input
            autoFocus
            value={q}
            placeholder="Type a command"
            spellCheck={false}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            onKeyDown={listKeys({ count: entries.length, idx, setIdx, onEnter: () => enter(entries[idx]), onEscape: close })}
          />
        </div>
        <PaletteEntries list={list} entries={entries} idx={idx} blank={blank} q={q} run={run} runItem={runItem} runAll={runAll} />
        {!entries.length && <div className="palette-empty">Nothing matches</div>}
      </div>
    </div>
  );
}
