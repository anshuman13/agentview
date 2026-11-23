import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { notice } from '../app/store';
import { Back } from '../app/touch/back';
import { useNarrow } from '../app/shell/useNarrow';
import { Button, IconButton, ShowAll } from '../ui/Button';
import { Confirm, type ConfirmRequest } from '../ui/Confirm';
import { Icon } from '../ui/Icon';
import { Menu, MenuItem } from '../ui/Menu';
import { EmptyState } from '../ui/Panel';
import { Row } from '../ui/Row';
import { Section, sectionCount } from '../ui/Section';
import { Skeleton } from '../ui/Skeleton';
import { ask } from '../codex/data/ask/ask';
import { copyText, cx, plural } from '../ui/util';
import { groupPlan, KIND_ICONS, nextItem, scanText, splitTrips, totalsText, tripAsk, tripKind, tripState, tripStateText, type CheckItem, type PlanItem, type Receipt, type Trip } from '../../../shared/travel';
import { deleteTrip, exportUrl, receiptUrl, saveTrip, scanCalendar, setCheck, uploadReceipt } from './travelApi';
import { dayLabel, isImage, itemMeta, localNow, receiptMeta, shrink, tripDates, tripMeta } from './travelLogic';
import { HomeSheet, PlanItemSheet, ReceiptSheet, TripSheet } from './TravelSheets';
import { useTravel } from './useTravel';
import '../styles/features/wiki.css';
import '../styles/features/meetings.css';
import '../styles/features/travel.css';

const FOLD = 5;
const today = () => new Date().toLocaleDateString('sv-SE');
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// The hidden file inputs for taking a photo, choosing photos and choosing files; the buttons click them.
function useCapture(onPick: (list: FileList | null) => void) {
  const camera = useRef<HTMLInputElement>(null);
  const photos = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const change = (e: ChangeEvent<HTMLInputElement>) => { onPick(e.target.files); e.target.value = ''; };
  const inputs = (
    <>
      <input ref={camera} hidden type="file" accept="image/*" capture="environment" onChange={change} />
      <input ref={photos} hidden type="file" multiple accept="image/*" onChange={change} />
      <input ref={files} hidden type="file" multiple accept="image/*,application/pdf,.pdf,.heic" onChange={change} />
    </>
  );
  return { inputs, takePhoto: () => camera.current?.click(), addPhotos: () => photos.current?.click(), addFiles: () => files.current?.click() };
}

type Capture = ReturnType<typeof useCapture>;

function CaptureRow({ cap, narrow }: { cap: Capture; narrow: boolean }) {
  return (
    <div className="tv-add">
      <Button variant="filled" icon="device-camera" onClick={cap.takePhoto}>Take photo</Button>
      {narrow ? (
        <>
          <Button icon="file-media" onClick={cap.addPhotos}>Photo</Button>
          <Button icon="file" onClick={cap.addFiles}>PDF / file</Button>
        </>
      ) : <Button icon="add" onClick={cap.addFiles}>Add files</Button>}
    </div>
  );
}

function TripList({ trips, receipts, filing, cap, narrow, archivedOpen, onArchived, onOpen, onNew, find }: { trips: Trip[]; receipts: Receipt[]; filing: number; cap: Capture; narrow: boolean; archivedOpen: boolean; onArchived: () => void; onOpen: (id: string) => void; onNew: () => void; find: ReactNode }) {
  const [all, setAll] = useState(false);
  const day = today();
  const { active, archived } = splitTrips(trips, day);
  const rows = all ? active : active.slice(0, FOLD);
  const row = (t: Trip) => <Row key={t.id} leading={<Icon name="briefcase" />} title={t.name} meta={tripMeta(t, receipts.filter((r) => r.tripId === t.id), day)} onClick={() => onOpen(t.id)} />;
  const capture = !narrow && <><Button size="sm" icon="device-camera" onClick={cap.takePhoto}>Take photo</Button><Button size="sm" icon="add" onClick={cap.addFiles}>Add files</Button></>;
  return (
    <div className="tv-trip">
      {narrow && <CaptureRow cap={cap} narrow />}
      {cap.inputs}
      {filing > 0 && <div className="ui-group"><Row plain leading={<span className="tv-thumb tv-file"><Icon name="loading" spin /></span>} title={`Adding ${plural(filing, 'receipt')}…`} /></div>}
      <section>
        <Section label="Trips" count={sectionCount(active.length)} action={<>{find}{capture}<Button size="sm" icon="add" onClick={onNew}>New trip</Button></>} />
        {active.length ? <div className="ui-group">{rows.map(row)}</div> : <EmptyState size="sm" icon="briefcase" title="No upcoming trips" hint="Find in calendar or New trip adds one" />}
        {rows.length < active.length && <ShowAll count={active.length} className="ov-more" onClick={() => setAll(true)} />}
      </section>
      {archived.length > 0 && (
        <section>
          <Section label="Archived" count={archived.length} open={archivedOpen} onToggle={onArchived} />
          {archivedOpen && <div className="ui-group">{archived.map(row)}</div>}
        </section>
      )}
    </div>
  );
}

function Thumb({ r }: { r: Receipt }) {
  return isImage(r) ? <img className="tv-thumb" src={receiptUrl(r.id)} alt="" loading="lazy" /> : <span className="tv-thumb tv-file"><Icon name={r.mime === 'application/pdf' ? 'file-pdf' : 'file'} /></span>;
}

function NotesField({ trip, onSaved }: { trip: Trip; onSaved: () => void }) {
  const [text, setText] = useState(trip.notes);
  useEffect(() => setText(trip.notes), [trip.id, trip.notes]);
  const save = () => {
    if (text === trip.notes) return;
    saveTrip({ id: trip.id, name: trip.name, from: trip.from, to: trip.to, notes: text }).then(onSaved, (e) => notice(`Notes not saved: ${errText(e)}`));
  };
  return (
    <section>
      <Section label="Notes" />
      <div className="ui-group"><div className="ui-fields">
        <textarea className="tv-notes" rows={3} aria-label="Trip notes" placeholder="Booking codes, addresses" value={text} onChange={(e) => setText(e.target.value)} onBlur={save} />
      </div></div>
    </section>
  );
}

function Itinerary({ trip, onAdd, onOpen }: { trip: Trip; onAdd: () => void; onOpen: (item: PlanItem) => void }) {
  const plan = trip.plan ?? [];
  const day = today();
  const next = tripState(trip, day) === 'now' ? nextItem(plan, localNow()) : undefined;
  return (
    <section>
      <Section label="Itinerary" count={sectionCount(plan.length)} action={<Button size="sm" icon="add" onClick={onAdd}>Add item</Button>} />
      {plan.length ? groupPlan(plan).map((g) => (
        <div key={g.day}>
          <Section label={dayLabel(g.day, day)} />
          <div className="ui-group">
            {g.items.map((i) => (
              <Row
                key={i.id}
                className={cx('tv-item', i.id === next?.id && 'tv-next')}
                leading={<><span className={cx('tv-when', !i.start && 'all')}><span>{i.start || 'All day'}</span>{i.end && <span>{i.end}</span>}</span><Icon name={KIND_ICONS[i.kind]} /></>}
                title={i.title}
                meta={itemMeta(i)}
                onClick={() => onOpen(i)}
              />
            ))}
          </div>
        </div>
      )) : <EmptyState size="sm" icon="calendar" title="No plan yet" hint="Find in calendar fills it in, or add an item" />}
    </section>
  );
}

// The count is the open items; a tap flips the row at once and back when the save fails.
function Checklist({ trip }: { trip: Trip }) {
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  useEffect(() => setFlipped({}), [trip.checklist]);
  const items = (trip.checklist ?? []).map((c): CheckItem => ({ ...c, done: flipped[c.id] ?? c.done }));
  if (!items.length) return null;
  const flip = (c: CheckItem) => {
    setFlipped((f) => ({ ...f, [c.id]: !c.done }));
    setCheck(trip.id, c.id, !c.done).catch(() => {
      setFlipped((f) => ({ ...f, [c.id]: c.done }));
      notice('Could not save the checklist');
    });
  };
  return (
    <section>
      <Section label="Checklist" count={sectionCount(items.filter((c) => !c.done).length)} />
      <div className="ui-group">
        {items.map((c) => <Row key={c.id} className={cx('tv-check', c.done && 'done')} leading={<Icon name={c.done ? 'check' : 'circle-outline'} />} title={c.text} onClick={() => flip(c)} />)}
      </div>
    </section>
  );
}

function TripView({ trip, receipts, home, onBack, reload }: { trip: Trip; receipts: Receipt[]; home: string; onBack: () => void; reload: () => Promise<void> }) {
  const narrow = useNarrow();
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [homing, setHoming] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [uploading, setUploading] = useState(0);
  const [all, setAll] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const [item, setItem] = useState<PlanItem | 'new' | null>(null);
  const sorted = [...receipts].sort((a, b) => b.addedAt - a.addedAt);
  const rows = all ? sorted : sorted.slice(0, FOLD);
  const receipt = receipts.find((r) => r.id === open);

  const add = async (list: FileList | null) => {
    const picked = [...(list ?? [])];
    if (!picked.length) return;
    setUploading((n) => n + picked.length);
    for (const f of picked) {
      try {
        const { blob, name } = await shrink(f);
        await uploadReceipt(trip.id, blob, name);
      } catch (e) {
        notice(`${f.name} not added: ${errText(e)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    void reload();
  };
  const cap = useCapture((list) => void add(list));
  const summary = () => [`${trip.name} (${tripDates(trip)})`, ...sorted.map((r) => `- ${receiptMeta(r)} ${r.merchant}`.trim()), `Total: ${totalsText(receipts) || 'none'}`].join('\n');

  return (
    <div className="tv-trip">
      <div className="tv-head">
        <Back close={onBack} />
        {!narrow && <IconButton icon="arrow-left" label="Back" onClick={onBack} />}
        <div className="tv-title">
          <h2>{trip.name}</h2>
          {tripDates(trip) && (
            <span className="tv-sub">{tripDates(trip)} · <span className={tripState(trip, today()) === 'now' ? 'tv-now' : undefined}>{tripStateText(trip, today())}</span></span>
          )}
        </div>
        <span className="ov-more">
          <IconButton ref={more} size="sm" icon="kebab-vertical" label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
          {menu && (
            <Menu trigger={more} onClose={() => setMenu(false)}>
              <MenuItem icon="sparkle" onClick={() => { setMenu(false); ask(tripAsk(trip, receipts, home), tripKind(trip) === 'work' ? 'work' : 'personal'); }}>Ask Claude</MenuItem>
              <MenuItem icon="home" onClick={() => { setMenu(false); setHoming(true); }}>Home address</MenuItem>
              <MenuItem icon="edit" onClick={() => { setMenu(false); setEditing(true); }}>Edit trip</MenuItem>
              <MenuItem icon="cloud-download" href={exportUrl(trip.id)} onClick={() => setMenu(false)}>Export receipts (CSV)</MenuItem>
              <MenuItem icon="copy" onClick={() => { setMenu(false); copyText(summary()).then(() => notice('Summary copied'), () => notice('Copy failed')); }}>Copy summary</MenuItem>
              <MenuItem icon="trash" danger onClick={() => {
                setMenu(false);
                setConfirm({ title: `Delete ${trip.name}?`, detail: 'Its receipts and their files are deleted too.', action: 'Delete', run: async () => { await deleteTrip(trip.id); onBack(); await reload(); } });
              }}>Delete trip</MenuItem>
            </Menu>
          )}
        </span>
      </div>

      <CaptureRow cap={cap} narrow={narrow} />
      {cap.inputs}

      <Itinerary trip={trip} onAdd={() => setItem('new')} onOpen={setItem} />

      <Checklist trip={trip} />

      <section>
        <Section label="Receipts" count={sectionCount(receipts.length)} />
        {receipts.length || uploading ? (
          <div className="ui-group">
            {uploading > 0 && <Row plain leading={<span className="tv-thumb tv-file"><Icon name="loading" spin /></span>} title={`Uploading ${uploading}…`} />}
            {rows.map((r) => <Row key={r.id} leading={<Thumb r={r} />} title={r.merchant || r.name} meta={receiptMeta(r)} onClick={() => setOpen(r.id)} />)}
          </div>
        ) : (
          <EmptyState size="sm" icon="file-media" title="No receipts yet" hint="Take a photo or add a PDF; Claude fills in the amount" />
        )}
        {rows.length < sorted.length && <ShowAll count={sorted.length} className="ov-more" onClick={() => setAll(true)} />}
        {receipts.length > 0 && <div className="tv-total">Total {totalsText(receipts) || 'none yet'}</div>}
      </section>

      <NotesField trip={trip} onSaved={() => void reload()} />

      {item && <PlanItemSheet key={item === 'new' ? 'new' : item.id} trip={trip} item={item === 'new' ? undefined : item} today={today()} onClose={() => setItem(null)} onSaved={() => void reload()} />}
      {receipt && <ReceiptSheet key={`${receipt.id}-${receipt.read}`} receipt={receipt} onClose={() => setOpen(null)} onSaved={reload} />}
      {editing && <TripSheet trip={trip} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void reload(); }} />}
      {homing && <HomeSheet home={home} onClose={() => setHoming(false)} onSaved={() => { setHoming(false); void reload(); }} />}
      {confirm && <Confirm {...confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

export function Travel({ shown }: { shown: boolean }) {
  const { data, error, reload } = useTravel(shown);
  const [open, setOpen] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [finding, setFinding] = useState(false);
  const [filing, setFiling] = useState(0);
  const narrow = useNarrow();
  const trips = useRef<Trip[]>([]);
  trips.current = data?.trips ?? [];
  const fileFromList = (list: FileList | null) => {
    const picked = [...(list ?? [])];
    if (!picked.length) return;
    setFiling((n) => n + picked.length);
    void Promise.all(picked.map(async (f) => {
      try {
        const { blob, name } = await shrink(f);
        const r = await uploadReceipt('', blob, name);
        notice(`Added to ${trips.current.find((t) => t.id === r.tripId)?.name ?? 'a trip'}${r.read === 'failed' ? ', could not read it' : ''}`);
      } catch (e) {
        notice(`Receipt not added: ${errText(e)}`);
      } finally {
        setFiling((n) => n - 1);
      }
    })).then(reload);
  };
  const cap = useCapture(fileFromList);
  const findTrips = () => {
    setFinding(true);
    scanCalendar().then((r) => { notice(scanText(r.added, r.updated)); return reload(); }, (e) => notice(`Calendar not read: ${errText(e)}`)).finally(() => setFinding(false));
  };
  const find = <Button size="sm" icon="calendar" disabled={finding} onClick={findTrips}>{finding ? 'Reading calendar…' : 'Find in calendar'}</Button>;
  const trip = data?.trips.find((t) => t.id === open);
  const body = trip ? (
    <TripView trip={trip} receipts={data!.receipts.filter((r) => r.tripId === trip.id)} home={data!.home ?? ''} onBack={() => setOpen(null)} reload={reload} />
  ) : data?.trips.length ? (
    <TripList trips={data.trips} receipts={data.receipts} filing={filing} cap={cap} narrow={narrow} archivedOpen={archivedOpen} onArchived={() => setArchivedOpen(!archivedOpen)} onOpen={setOpen} onNew={() => setAdding(true)} find={find} />
  ) : data ? (
    <EmptyState icon="briefcase" title="No trips yet" hint="Find your trips in the calendar, or add one, then its receipts, bookings and notes" action={<>{find}<Button size="sm" onClick={() => setAdding(true)}>New trip</Button></>} />
  ) : error ? (
    <EmptyState size="sm" icon="briefcase" title="Could not load trips" hint={error} action={<Button size="sm" onClick={() => void reload()}>Retry</Button>} />
  ) : (
    <Skeleton />
  );
  return (
    <div className="wk"><div className="wk-scroll"><div className="mt-page tv-page">
      {body}
      {adding && <TripSheet onClose={() => setAdding(false)} onSaved={(t) => { setAdding(false); void reload().then(() => setOpen(t.id)); }} />}
    </div></div></div>
  );
}
