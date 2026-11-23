import { useState } from 'react';
import { notice } from '../app/store';
import { Button, Chip } from '../ui/Button';
import { Sheet } from '../ui/Sheet';
import { CATEGORIES, type Receipt, type Trip } from '../../../shared/travel';
import { deleteReceipt, receiptUrl, saveTrip, updateReceipt } from './travelApi';
import { isImage } from './travelLogic';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function TripSheet({ trip, onClose, onSaved }: { trip?: Trip; onClose: () => void; onSaved: (t: Trip) => void }) {
  const [name, setName] = useState(trip?.name ?? '');
  const [from, setFrom] = useState(trip?.from ?? '');
  const [to, setTo] = useState(trip?.to ?? '');
  const [busy, setBusy] = useState(false);
  const save = () => {
    if (!name.trim()) return;
    setBusy(true);
    saveTrip({ ...trip, name, from, to: to || from }).then(onSaved, (e) => { notice(errText(e)); setBusy(false); });
  };
  return (
    <Sheet label={trip ? 'Edit trip' : 'New trip'} onClose={onClose}>
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

export function ReceiptSheet({ receipt: r, onClose, onSaved }: { receipt: Receipt; onClose: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = useState({ merchant: r.merchant, amount: r.amount == null ? '' : String(r.amount), currency: r.currency, date: r.date, note: r.note, category: r.category });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = () => {
    setBusy(true);
    updateReceipt({ id: r.id, ...f, amount: f.amount as unknown as number })
      .then(() => onSaved().then(onClose), (e) => { notice(errText(e)); setBusy(false); });
  };
  const remove = () => deleteReceipt(r.id).then(() => { notice('Receipt deleted'); onClose(); void onSaved(); }, (e) => notice(errText(e)));
  return (
    <Sheet label="Receipt" onClose={onClose} className="tv-receipt">
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
