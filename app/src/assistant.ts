import { FIELDS, rowToChange, mergeIncoming } from './assistant-sync';
import type { Change, ItemRow, Profile, PulledChange } from './assistant-sync';

const invoke = window.__TAURI__?.core?.invoke;
const shell = window.AgentViewShell;
const LOCK_AFTER = 60000;
const SYNC_EVERY = 60000;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS items (
    id TEXT NOT NULL,
    profile TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    field_times TEXT NOT NULL DEFAULT '{}',
    ${FIELDS.join(',\n    ')},
    dirty INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (profile, id)
  );
  CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT);
`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  lock: $('lock-screen'),
  lockMsg: $('lock-msg'),
  unlock: $('unlock-btn'),
  content: $('content'),
  nav: $('nav'),
  filters: $('filters'),
  todayList: $('today-list'),
  laterList: $('later-list'),
  laterTitle: $('later-title'),
  notes: $('notes'),
  captureText: $<HTMLTextAreaElement>('capture-text'),
  taskToggle: $('task-toggle'),
  noteToggle: $('note-toggle'),
  workToggle: $('work-toggle'),
  personalToggle: $('personal-toggle'),
  save: $('save-btn'),
  saveConfirm: $('save-confirm'),
  hubUrl: $<HTMLInputElement>('hub-url'),
  settingsSave: $('settings-save'),
  syncNow: $('sync-now'),
  syncStatus: $('sync-status'),
};

let unlocked = false;
let unlocking: Promise<void> | null = null;
let closing: Promise<void> = Promise.resolve();
let syncing = false;
let syncAgain = false;
let saving = false;
let tab = 'today';
let filter: 'all' | Profile = 'all';
let captureType = 'task';
let captureProfile: Profile = localStorage.getItem('assistant-profile') === 'personal' ? 'personal' : 'work';
let hiddenAt = 0;
let lockTimer: ReturnType<typeof setTimeout> | undefined;

type SqlValue = string | number | null;

const errorText = (err: unknown) => (err as Error | undefined)?.message || String(err);
const query = async <T = ItemRow>(sql: string, params: SqlValue[] = []) => (await invoke!<T[] | null>('assistant_query', { sql, params })) || [];
const exec = (sql: string, params: SqlValue[] = []) => invoke!<number>('assistant_exec', { sql, params });
const HUB = 'http://macmini.netbird.cloud:7790';

async function getState(key: string) {
  const rows = await query<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [key]);
  return rows[0]?.value ?? '';
}

const setState = (key: string, value: string | number) => exec('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', [key, String(value)]);

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string | null, text?: string | null) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function button(text: string, onClick: () => void, className?: string) {
  const b = node('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function showLock(message: string, label: string | null) {
  el.lockMsg.textContent = message;
  el.unlock.textContent = label || '';
  el.unlock.hidden = !label;
  el.lock.hidden = false;
  el.content.hidden = true;
  el.nav.hidden = true;
}

function getKey(): Promise<string> {
  if (!shell) return invoke!<string>('assistant_dev_key');
  return new Promise((resolve, reject) => {
    window.addEventListener('assistant-key', (e) => {
      if (e.detail?.key) resolve(e.detail.key);
      else reject(new Error(e.detail?.error || 'Unlock cancelled'));
    }, { once: true });
    shell.unlock();
  });
}

async function openStore() {
  showLock('Unlocking', null);
  try {
    if (!invoke) throw new Error('The Assistant needs the AgentView app.');
    await closing;
    const key = await getKey();
    await invoke('assistant_open', { key });
    await invoke('assistant_batch', { sql: SCHEMA });
    unlocked = true;
    el.lock.hidden = true;
    el.content.hidden = false;
    el.nav.hidden = false;
    render();
    sync();
  } catch (err) {
    showLock(errorText(err), 'Retry');
  }
}

async function unlockDb() {
  if (unlocked) return;
  if (unlocking) return unlocking;
  unlocking = openStore();
  try {
    await unlocking;
  } finally {
    unlocking = null;
  }
}

function lock() {
  clearTimeout(lockTimer);
  if (!unlocked) return;
  unlocked = false;
  for (const list of [el.todayList, el.laterList, el.notes]) list.replaceChildren();
  el.laterTitle.hidden = true;
  el.hubUrl.value = '';
  el.syncStatus.textContent = '';
  showLock('Locked', 'Unlock');
  closing = invoke!<void>('assistant_close').catch((err) => console.error('assistant_close failed', err));
}

function atTime(at: ItemRow['at']) {
  if (at == null || at === '') return null;
  const n = Number(at);
  if (Number.isFinite(n)) return n;
  const parsed = Date.parse(String(at));
  return Number.isNaN(parsed) ? null : parsed;
}

function nextNine() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9).getTime();
}

async function edit(row: ItemRow, sql: string, params: (now: number) => SqlValue[]) {
  try {
    const now = Date.now();
    await exec(
      `UPDATE items SET ${sql}, updated_at = max(updated_at, ?), dirty = 1 WHERE profile = ? AND id = ?`,
      [...params(now), now, row.profile, row.id],
    );
    render();
    sync();
  } catch (err) {
    if (unlocked) console.error('Edit failed', err);
  }
}

const markDone = (row: ItemRow) => edit(row, `status = 'done', field_times = json_set(field_times, '$.status', ?)`, (now) => [now]);
const snooze = (row: ItemRow) => edit(row, `at = ?, field_times = json_set(field_times, '$.at', ?)`, (now) => [nextNine(), now]);
const remove = (row: ItemRow) => edit(row, `deleted = 1, field_times = json_set(field_times, '$.deleted', ?)`, (now) => [now]);

function taskRow(row: ItemRow) {
  const content = node('div', 'task-content');
  content.append(node('span', 'task-tag', row.profile === 'work' ? 'Work' : 'Personal'), node('div', 'task-title', row.title || '(Untitled)'));
  const actions = node('div', 'task-actions');
  actions.append(button('Done', () => markDone(row)), button('Snooze', () => snooze(row)));
  const div = node('div', 'task-row');
  div.append(content, actions);
  return div;
}

function noteItem(row: ItemRow) {
  const div = node('div', 'note-item');
  div.append(node('div', 'note-item-title', row.title || '(Untitled)'));
  if (row.text) div.append(node('div', 'note-item-text', String(row.text).slice(0, 100)));
  div.append(button('Delete', () => remove(row)));
  return div;
}

async function renderToday() {
  const profiles = filter === 'all' ? ['work', 'personal'] : [filter];
  const rows = await query(
    `SELECT * FROM items WHERE deleted = 0 AND status = 'open' AND profile IN (${profiles.map(() => '?').join(', ')}) ORDER BY at, updated_at`,
    profiles,
  );
  if (!unlocked) return;
  const now = Date.now();
  const isLater = (r: ItemRow) => (atTime(r.at) ?? 0) > now;
  const later = rows.filter(isLater);
  el.todayList.replaceChildren(...rows.filter((r) => !isLater(r)).map(taskRow));
  el.laterList.replaceChildren(...later.map(taskRow));
  el.laterTitle.hidden = !later.length;
}

async function renderNotes() {
  const rows = await query(`SELECT * FROM items WHERE deleted = 0 AND status = 'note' ORDER BY updated_at DESC`);
  if (unlocked) el.notes.replaceChildren(...rows.map(noteItem));
}

async function renderSettings() {
  const [hubUrl, lastSync, lastError] = await Promise.all(['hub_url', 'last_sync', 'last_error'].map(getState));
  if (!unlocked) return;
  if (document.activeElement !== el.hubUrl) el.hubUrl.value = hubUrl || HUB;
  const status = lastSync ? `Last sync: ${new Date(Number(lastSync)).toLocaleString()}` : 'Never synced';
  el.syncStatus.textContent = lastError ? `${status}\nError: ${lastError}` : status;
}

async function render() {
  if (!unlocked) return;
  try {
    if (tab === 'today') await renderToday();
    else if (tab === 'notes') await renderNotes();
    else if (tab === 'settings') await renderSettings();
  } catch (err) {
    if (unlocked) console.error('Render failed', err);
  }
}

function switchTab(name: string) {
  tab = name;
  for (const s of document.querySelectorAll<HTMLElement>('.screen')) s.classList.toggle('active', s.id === name);
  for (const b of el.nav.querySelectorAll('button')) b.classList.toggle('active', b.dataset.tab === name);
  if (name === 'capture') el.captureText.focus();
  render();
}

async function saveCapture() {
  const value = el.captureText.value.trim();
  if (!value || saving || !unlocked) return;
  saving = true;
  try {
    const [first, ...rest] = value.split('\n');
    const now = Date.now();
    const times = JSON.stringify({ title: now, text: now, source: now, status: now });
    await exec(
      `INSERT INTO items (id, profile, version, updated_at, deleted, field_times, title, text, source, status, dirty)
       VALUES (?, ?, 0, ?, 0, ?, ?, ?, 'capture', ?, 1)`,
      [crypto.randomUUID(), captureProfile, now, times, first.slice(0, 120), rest.join('\n').trim() || null, captureType === 'note' ? 'note' : 'open'],
    );
    el.captureText.value = '';
    el.saveConfirm.textContent = 'Saved';
    setTimeout(() => (el.saveConfirm.textContent = ''), 2000);
    sync();
  } catch (err) {
    el.saveConfirm.textContent = `Not saved: ${errorText(err)}`;
  } finally {
    saving = false;
  }
}

async function applyChange(change: PulledChange) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const local = (await query('SELECT * FROM items WHERE profile = ? AND id = ?', [change.profile, change.id]))[0];
    const m = mergeIncoming(local ?? null, change);
    const values = [m.version, m.updated_at, m.deleted, JSON.stringify(m.field_times), ...FIELDS.map((f) => m[f]), m.dirty];
    const changed = local
      ? await exec(
        `UPDATE items SET version = ?, updated_at = ?, deleted = ?, field_times = ?, ${FIELDS.map((f) => `${f} = ?`).join(', ')}, dirty = ?
         WHERE profile = ? AND id = ? AND updated_at = ? AND field_times = ?`,
        [...values, m.profile, m.id, local.updated_at, local.field_times],
      )
      : await exec(
        `INSERT OR IGNORE INTO items (version, updated_at, deleted, field_times, ${FIELDS.join(', ')}, dirty, profile, id)
         VALUES (${Array(values.length + 2).fill('?').join(', ')})`,
        [...values, m.profile, m.id],
      );
    if (changed) return;
  }
  throw new Error(`Could not merge item ${change.id}`);
}

async function post(hubUrl: string, body: { since: number; changes: Change[] }): Promise<{ version: number; changes: PulledChange[]; hasMore?: boolean }> {
  const resp = await fetch(`${hubUrl}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`Hub returned HTTP ${resp.status}`);
  const data = await resp.json();
  if (!Array.isArray(data?.changes) || typeof data.version !== 'number') throw new Error('Unexpected hub response');
  return data;
}

async function syncOnce() {
  const hubUrl = (await getState('hub_url')) || HUB;
  let since = Number(await getState('since')) || 0;
  let pushed = await query('SELECT * FROM items WHERE dirty = 1');
  let more = true;
  while (more && unlocked) {
    const data = await post(hubUrl, { since, changes: pushed.map(rowToChange) });
    for (const row of pushed) {
      await exec(
        'UPDATE items SET dirty = 0 WHERE profile = ? AND id = ? AND updated_at = ? AND field_times = ?',
        [row.profile, row.id, row.updated_at, row.field_times],
      );
    }
    pushed = [];
    for (const change of data.changes) {
      if (change?.table !== 'items' || typeof change.id !== 'string' || !['work', 'personal'].includes(change.profile)) continue;
      await applyChange(change);
    }
    more = data.hasMore === true;
    if (more && data.version <= since) throw new Error('Hub did not advance the sync version');
    since = data.version;
    await setState('since', since);
  }
  await setState('last_sync', Date.now());
  await setState('last_error', '');
}

async function sync() {
  if (!unlocked) return;
  if (syncing) {
    syncAgain = true;
    return;
  }
  syncing = true;
  try {
    do {
      syncAgain = false;
      try {
        await syncOnce();
      } catch (err) {
        if (unlocked) await setState('last_error', errorText(err)).catch(() => {});
      }
    } while (syncAgain && unlocked);
  } finally {
    syncing = false;
  }
  if (tab !== 'capture') render();
}

el.unlock.addEventListener('click', unlockDb);

for (const b of el.nav.querySelectorAll('button')) b.addEventListener('click', () => switchTab(b.dataset.tab!));

for (const p of ['all', 'work', 'personal'] as const) {
  const chip = button(p[0].toUpperCase() + p.slice(1), () => {
    filter = p;
    for (const c of el.filters.children) c.classList.toggle('active', c === chip);
    render();
  }, `filter-chip${p === filter ? ' active' : ''}`);
  el.filters.append(chip);
}

function setType(type: 'task' | 'note') {
  captureType = type;
  el.taskToggle.classList.toggle('active', type === 'task');
  el.noteToggle.classList.toggle('active', type === 'note');
}

function setProfile(profile: Profile) {
  captureProfile = profile;
  localStorage.setItem('assistant-profile', profile);
  el.workToggle.classList.toggle('active', profile === 'work');
  el.personalToggle.classList.toggle('active', profile === 'personal');
}

el.taskToggle.addEventListener('click', () => setType('task'));
el.noteToggle.addEventListener('click', () => setType('note'));
el.workToggle.addEventListener('click', () => setProfile('work'));
el.personalToggle.addEventListener('click', () => setProfile('personal'));
setProfile(captureProfile);

el.save.addEventListener('click', saveCapture);

el.settingsSave.addEventListener('click', async () => {
  if (!unlocked) return;
  try {
    const hubUrl = el.hubUrl.value.trim().replace(/\/+$/, '');
    if (hubUrl !== (await getState('hub_url'))) {
      await setState('since', 0);
      await exec('UPDATE items SET dirty = 1');
    }
    await setState('hub_url', hubUrl);
    el.hubUrl.blur();
    await renderSettings();
    sync();
  } catch (err) {
    if (unlocked) el.syncStatus.textContent = `Not saved: ${errorText(err)}`;
  }
});

el.syncNow.addEventListener('click', sync);

setInterval(sync, SYNC_EVERY);
window.addEventListener('online', sync);

document.addEventListener('visibilitychange', () => {
  clearTimeout(lockTimer);
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    lockTimer = setTimeout(lock, LOCK_AFTER);
    return;
  }
  if (hiddenAt && Date.now() - hiddenAt >= LOCK_AFTER) lock();
  if (unlocked) sync();
  else unlockDb();
});

unlockDb();
