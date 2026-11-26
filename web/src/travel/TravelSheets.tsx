import { useState } from 'react';
import { showSnack } from '../codex/view';
import { loadErrorText } from '../../../shared/loadError';
import { Button, Chip } from '../ui/Button';
import { Sheet } from '../ui/Sheet';
import { CATEGORIES, PLAN_KINDS, tripState, type PlanItem, type Receipt, type Trip } from '../../../shared/travel';
import { deleteReceipt, receiptUrl, saveHome, saveTrip, updateReceipt } from './travelApi';
import { isImage } from './travelLogic';

const errText = (e: unknown) => loadErrorText(e instanceof Error ? e.message : String(e));

export function TripSheet({ trip, onClose, onSaved }: { trip?: Trip; onClose: () => void; onSaved: (t: Trip) => void }) {
  const [name, setName] = useState(trip?.name ?? '');
  const [from, setFrom] = useState(trip?.from ?? '');
  const [to, setTo] = useState(trip?.to ?? '');
  const [busy, setBusy] = useState(false);
  const save = () => {
    if (!name.trim()) return;
    setBusy(true);
    saveTrip({ id: trip?.id, name, from, to: to || from }).then(onSaved, (e) => { showSnack(errText(e)); setBusy(false); });
  };
  return (
    <Sheet label={trip ? 'Edit trip' : 'New trip'} onClose={onClose} className="ui-motion">
      <h2 className="tv-sheet-title">{trip ? 'Edit trip' : 'New trip'}</h2>
      <div className="ui-fields">
        <input autoFocus aria-label="Trip name" placeholder="Trip, such as Stockholm offsite" value={name} enterKeyHint="done" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <label className="tv-date">From<input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (!to || to < e.target.value) setTo(e.target.value); }} /></label>
        <label className="tv-date">To<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <div className="tv-actions">
        <Button size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="filled" disabled={busy || !name.trim()} onClick={save}>Save</Button>
      </div>
    </Sheet>
  );
}

// The start address Claude plans the way to the airport from; empty clears it.
export function HomeSheet({ home, onClose, onSaved }: { home: string; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(home);
  const [busy, setBusy] = useState(false);
  const save = () => {
    setBusy(true);
    saveHome(value).then(() => { showSnack('Home address saved'); onSaved(); }, (e) => { showSnack(errText(e)); setBusy(false); });
  };
  return (
    <Sheet label="Home address" onClose={onClose} className="ui-motion">
      <h2 className="tv-sheet-title">Home address</h2>
      <div className="ui-fields">
        <input autoFocus aria-label="Home address" placeholder="Street, city" value={value} enterKeyHint="done" onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      </div>
      <div className="tv-actions">
        <Button size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="filled" disabled={busy} onClick={save}>Save</Button>
      </div>
    </Sheet>
  );
}

const KIND_LABELS = Object.fromEntries(PLAN_KINDS.map((k) => [k, k[0].toUpperCase() + k.slice(1)]));

// Adds or edits one plan item, or deletes it; an item save sends the whole plan.
export function PlanItemSheet({ trip, item, today, onClose, onSaved }: { trip: Trip; item?: PlanItem; today: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    kind: item?.kind ?? 'event', title: item?.title ?? '', day: item?.day ?? (tripState(trip, today) === 'now' ? today : trip.from || today),
    start: item?.start ?? '', end: item?.end ?? '', place: item?.place ?? '', ref: item?.ref ?? '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const write = (plan: NonNullable<Parameters<typeof saveTrip>[0]['plan']>, done: () => void) => {
    setBusy(true);
    saveTrip({ id: trip.id, name: trip.name, from: trip.from, to: trip.to, plan }).then(() => { done(); onSaved(); }, () => { showSnack('Could not save the item. Your text is still here.'); setBusy(false); });
  };
  const plan = trip.plan ?? [];
  const save = () => write(item ? plan.map((p) => (p.id === item.id ? { ...p, ...f } : p)) : [...plan, f], onClose);
  const remove = () => write(plan.filter((p) => p.id !== item?.id), () => { showSnack('Item deleted'); onClose(); });
  return (
    <Sheet label={item ? 'Edit item' : 'Add item'} onClose={onClose} className="ui-motion">
      <h2 className="tv-sheet-title">{item ? 'Edit item' : 'Add item'}</h2>
      <div className="ui-fields">
        <div className="tv-chips" role="group" aria-label="Kind">
          {PLAN_KINDS.map((k) => <Chip key={k} size="sm" on={f.kind === k} aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k })}>{KIND_LABELS[k]}</Chip>)}
        </div>
        <input autoFocus aria-label="Title" placeholder="Title, such as OSL to ARN" value={f.title} onChange={set('title')} />
        <label className="tv-date">Day<input type="date" value={f.day} onChange={set('day')} /></label>
        <label className="tv-date">Start<input type="time" value={f.start} onChange={set('start')} /></label>
        <label className="tv-date">End<input type="time" value={f.end} onChange={set('end')} /></label>
        <input aria-label="Place" placeholder="Place" value={f.place} onChange={set('place')} />
        <input aria-label="Booking or flight number" placeholder="Booking or flight number" value={f.ref} onChange={set('ref')} />
      </div>
      <div className="tv-actions">
        {item ? <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={remove}>Delete</Button> : <Button size="sm" onClick={onClose}>Cancel</Button>}
        <Button size="sm" variant="filled" disabled={busy || !f.title.trim() || !f.day} onClick={save}>Save</Button>
      </div>
    </Sheet>
  );
}

export function ReceiptSheet({ receipt: r, onClose, onSaved }: { receipt: Receipt; onClose: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = useState({ merchant: r.merchant, amount: r.amount == null ? '' : String(r.amount), currency: r.currency, date: r.date, note: r.note, category: r.category });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = () => {
    setBusy(true);
    updateReceipt({ id: r.id, ...f, amount: f.amount as unknown as number })
      .then(() => onSaved().then(onClose), (e) => { showSnack(errText(e)); setBusy(false); });
  };
  const remove = () => deleteReceipt(r.id).then(() => { showSnack('Receipt deleted'); onClose(); void onSaved(); }, (e) => showSnack(errText(e)));
  return (
    <Sheet label="Receipt" onClose={onClose} className="tv-receipt ui-motion">
      <h2 className="tv-sheet-title">{r.read === 'pending' ? 'Claude is reading this receipt…' : r.merchant || r.name}</h2>
      <a className="tv-preview" href={receiptUrl(r.id)} target="_blank" rel="noreferrer">
        {isImage(r) ? <img src={receiptUrl(r.id)} alt={r.name} /> : <span>Open {r.name}</span>}
      </a>
      <div className="ui-fields">
        <input aria-label="Merchant" placeholder="Merchant" value={f.merchant} onChange={set('merchant')} />
        <div className="tv-pair">
          <input aria-label="Amount" placeholder="Amount" inputMode="decimal" value={f.amount} onChange={set('amount')} />
          <input aria-label="Currency" placeholder="NOK" maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />
        </div>
        <input type="date" aria-label="Date" value={f.date} onChange={set('date')} />
        <div className="tv-chips" role="group" aria-label="Category">
          {CATEGORIES.map((c) => <Chip key={c} size="sm" on={f.category === c} aria-pressed={f.category === c} onClick={() => setF({ ...f, category: c })}>{c}</Chip>)}
        </div>
        <input aria-label="Note" placeholder="Note, such as dinner with the Bergen team" value={f.note} onChange={set('note')} />
      </div>
      <div className="tv-actions">
        <Button size="sm" variant="danger" icon="trash" onClick={() => void remove()}>Delete</Button>
        <Button size="sm" variant="filled" disabled={busy} onClick={save}>Save</Button>
      </div>
    </Sheet>
  );
}
