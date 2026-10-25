import { FIELDS, rowToChange, mergeIncoming } from './assistant-sync.js';

const invoke = window.__TAURI__?.core?.invoke || (() => Promise.reject(new Error('Tauri not available')));
const shell = window.AgentViewShell;

let db = null;
let dbKey = null;
let currentTab = 'today';
let currentProfile = 'all';
let currentType = 'task';
let syncTimer = null;
let lockTimer = null;
let isLocked = false;

const elements = {
  lockScreen: document.getElementById('lock-screen'),
  content: document.getElementById('content'),
  unlockBtn: document.getElementById('unlock-btn'),
  retryBtn: document.getElementById('retry-btn'),
  lockMsg: document.getElementById('lock-msg'),
  nav: document.getElementById('nav'),
  todayTab: document.getElementById('today-tab'),
  captureTab: document.getElementById('capture-tab'),
  notesTab: document.getElementById('notes-tab'),
  settingsTab: document.getElementById('settings-tab'),
  todayScreen: document.getElementById('today'),
  captureScreen: document.getElementById('capture'),
  notesScreen: document.getElementById('notes'),
  settingsScreen: document.getElementById('settings'),
  filters: document.getElementById('filters'),
  todayList: document.getElementById('today-list'),
  laterList: document.getElementById('later-list'),
  laterTitle: document.getElementById('later-title'),
  captureText: document.getElementById('capture-text'),
  taskToggle: document.getElementById('task-toggle'),
  noteToggle: document.getElementById('note-toggle'),
  workToggle: document.getElementById('work-toggle'),
  personalToggle: document.getElementById('personal-toggle'),
  saveBtn: document.getElementById('save-btn'),
  saveConfirm: document.getElementById('save-confirm'),
  hubUrl: document.getElementById('hub-url'),
  deviceKey: document.getElementById('device-key'),
  settingsSave: document.getElementById('settings-save'),
  syncNow: document.getElementById('sync-now'),
  syncStatus: document.getElementById('sync-status'),
};

async function query(sql, params = []) {
  const r = await invoke('assistant_query', { sql, params });
  return r || [];
}

async function exec(sql, params = []) {
  return await invoke('assistant_exec', { sql, params });
}

async function batch(sql) {
  return await invoke('assistant_batch', { sql });
}

async function initDb() {
  const schema = `
    CREATE TABLE IF NOT EXISTS items (
      id TEXT NOT NULL,
      profile TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      field_times TEXT NOT NULL DEFAULT '{}',
      title,
      text,
      source,
      source_url,
      people,
      at,
      status,
      dirty INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (profile, id)
    );
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `;
  await batch(schema);
}

async function getKey() {
  if (dbKey) return dbKey;

  if (shell) {
    return new Promise((resolve) => {
      const handler = (e) => {
        window.removeEventListener('assistant-key', handler);
        if (e.detail?.key) {
          dbKey = e.detail.key;
          resolve(dbKey);
        } else {
          resolve(null);
        }
      };
      window.addEventListener('assistant-key', handler, { once: true });
      setTimeout(() => {
        window.removeEventListener('assistant-key', handler);
        resolve(null);
      }, 5000);
      shell.unlock();
    });
  } else {
    const key = await invoke('assistant_dev_key');
    dbKey = key;
    return key;
  }
}

async function unlockDb() {
  try {
    const key = await getKey();
    if (!key) {
      elements.lockMsg.textContent = 'Failed to unlock. Check fingerprint or device key.';
      elements.unlockBtn.hidden = true;
      elements.retryBtn.hidden = false;
      return false;
    }
    await invoke('assistant_open', { key });
    await initDb();
    isLocked = false;
    elements.lockScreen.hidden = true;
    elements.content.hidden = false;
    db = true;
    setupSync();
    render();
    return true;
  } catch (err) {
    console.error('Unlock failed:', err);
    elements.lockMsg.textContent = err.message || 'Unlock failed';
    elements.unlockBtn.hidden = true;
    elements.retryBtn.hidden = false;
    return false;
  }
}

function lock() {
  isLocked = true;
  dbKey = null;
  db = null;
  elements.lockScreen.hidden = false;
  elements.content.hidden = true;
  elements.unlockBtn.hidden = false;
  elements.retryBtn.hidden = true;
  elements.lockMsg.textContent = 'Tap to unlock with fingerprint';
  if (syncTimer) clearInterval(syncTimer);
  if (lockTimer) clearTimeout(lockTimer);
}

async function render() {
  if (isLocked) return;

  if (currentTab === 'today') {
    await renderToday();
  } else if (currentTab === 'capture') {
    elements.captureText.focus();
  } else if (currentTab === 'notes') {
    await renderNotes();
  } else if (currentTab === 'settings') {
    await renderSettings();
  }
}

async function renderToday() {
  const now = Date.now();
  const profiles = currentProfile === 'all' ? ['work', 'personal'] : [currentProfile];

  const rows = await query(
    `SELECT * FROM items WHERE deleted = 0 AND status = 'open' AND profile IN (${profiles.map(() => '?').join(',')}) ORDER BY at ASC, updated_at ASC`,
    profiles
  );

  const today = rows.filter(r => r.at === null || parseInt(r.at) <= now);
  const later = rows.filter(r => r.at !== null && parseInt(r.at) > now);

  elements.todayList.innerHTML = today.map(r => taskRow(r)).join('');
  elements.laterList.innerHTML = later.map(r => taskRow(r)).join('');
  elements.laterTitle.hidden = later.length === 0;
}

function taskRow(row) {
  const profile = row.profile === 'work' ? 'Work' : 'Personal';
  const title = row.title || '(Untitled)';
  return `
    <div class="task-row" data-id="${row.id}" data-profile="${row.profile}">
      <div class="task-content">
        <span class="task-tag">${profile}</span>
        <div class="task-title">${escapeHtml(title)}</div>
      </div>
      <div class="task-actions">
        <button class="done-btn">Done</button>
        <button class="snooze-btn">Snooze</button>
      </div>
    </div>
  `;
}

async function renderNotes() {
  const rows = await query(
    `SELECT * FROM items WHERE status = 'note' AND deleted = 0 ORDER BY updated_at DESC`
  );

  elements.notesScreen.innerHTML = rows.map(r => noteItem(r)).join('');
}

function noteItem(row) {
  const title = row.title || '(Untitled)';
  const text = row.text ? escapeHtml(row.text.substring(0, 100)) : '';
  return `
    <div class="note-item" data-id="${row.id}" data-profile="${row.profile}">
      <div class="note-item-title">${escapeHtml(title)}</div>
      ${text ? `<div class="note-item-text">${text}</div>` : ''}
      <button class="delete-btn" style="padding: 4px 8px; font-size: 12px;">Delete</button>
    </div>
  `;
}

async function renderSettings() {
  const hubUrl = await getSyncState('hub_url', '');
  const deviceKey = await getSyncState('device_key', '');
  const lastSync = await getSyncState('last_sync', '0');
  const lastError = await getSyncState('last_error', '');

  elements.hubUrl.value = hubUrl;
  elements.deviceKey.value = deviceKey;

  if (lastSync === '0') {
    elements.syncStatus.textContent = 'Never synced';
  } else {
    const time = new Date(parseInt(lastSync));
    elements.syncStatus.textContent = `Last sync: ${time.toLocaleString()}`;
  }
  if (lastError) {
    elements.syncStatus.textContent += `\nError: ${lastError}`;
  }
}

async function getSyncState(key, defaultValue = '') {
  const r = await query('SELECT value FROM sync_state WHERE key = ?', [key]);
  return r.length > 0 ? r[0].value : defaultValue;
}

async function setSyncState(key, value) {
  await exec('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', [key, value]);
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('#nav button').forEach(b => b.classList.remove('active'));

  elements[tab + 'Screen'].classList.add('active');
  elements[tab + 'Tab'].classList.add('active');

  render();
  resetLockTimer();
}

function resetLockTimer() {
  if (lockTimer) clearTimeout(lockTimer);
  lockTimer = setTimeout(() => {
    if (document.visibilityState === 'hidden') {
      lock();
    }
  }, 60000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function saveCapture() {
  const text = elements.captureText.value.trim();
  if (!text) return;

  const profile = elements.personalToggle.classList.contains('active') ? 'personal' : 'work';
  const lines = text.split('\n');
  const title = lines[0].substring(0, 120);
  const rest = lines.slice(1).join('\n').trim();

  const id = crypto.randomUUID();
  const now = Date.now();
  const status = elements.noteToggle.classList.contains('active') ? 'note' : 'open';

  await exec(
    `INSERT INTO items (id, profile, version, updated_at, deleted, field_times, title, text, source, status, dirty)
     VALUES (?, ?, 0, ?, 0, ?, ?, ?, 'capture', ?, 1)`,
    [id, profile, now, JSON.stringify({ title: now, status: now }), title, rest || null, status]
  );

  elements.captureText.value = '';
  elements.saveConfirm.textContent = 'Saved';
  setTimeout(() => { elements.saveConfirm.textContent = ''; }, 2000);

  sync();
}

async function setupSync() {
  sync();
  syncTimer = setInterval(sync, 60000);
  window.addEventListener('online', sync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync();
  });
}

async function sync() {
  if (!db || isLocked) return;

  try {
    const hubUrl = await getSyncState('hub_url', '');
    const deviceKey = await getSyncState('device_key', '');

    if (!hubUrl || !deviceKey) return;

    let since = parseInt(await getSyncState('since', '0'));
    const changes = await query(
      `SELECT * FROM items WHERE dirty = 1`,
      []
    );

    const changeRows = changes.map(rowToChange);

    const body = JSON.stringify({ since, changes: changeRows });
    const resp = await fetch(`${hubUrl}/sync`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${deviceKey}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!resp.ok) {
      await setSyncState('last_error', `HTTP ${resp.status}`);
      return;
    }

    const data = await resp.json();

    for (const change of data.changes || []) {
      const local = (await query(
        'SELECT * FROM items WHERE id = ? AND profile = ?',
        [change.id, change.profile]
      ))[0];

      const merged = mergeIncoming(local, change);

      if (local) {
        await exec(
          `UPDATE items SET version = ?, deleted = ?, updated_at = ?, field_times = ?, title = ?, text = ?, source = ?, source_url = ?, people = ?, at = ?, status = ?, dirty = ?
           WHERE id = ? AND profile = ?`,
          [
            merged.version,
            merged.deleted,
            merged.updated_at,
            JSON.stringify(merged.field_times),
            merged.title || null,
            merged.text || null,
            merged.source || null,
            merged.source_url || null,
            merged.people || null,
            merged.at || null,
            merged.status || null,
            merged.dirty,
            merged.id,
            merged.profile,
          ]
        );
      } else {
        await exec(
          `INSERT INTO items (id, profile, version, deleted, updated_at, field_times, title, text, source, source_url, people, at, status, dirty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            merged.id,
            merged.profile,
            merged.version,
            merged.deleted,
            merged.updated_at,
            JSON.stringify(merged.field_times),
            merged.title || null,
            merged.text || null,
            merged.source || null,
            merged.source_url || null,
            merged.people || null,
            merged.at || null,
            merged.status || null,
            merged.dirty,
          ]
        );
      }
    }

    if (data.hasMore && data.version) {
      since = data.version;
      sync();
    } else {
      await setSyncState('since', data.version || since);
      await setSyncState('last_sync', String(Date.now()));
      await setSyncState('last_error', '');

      for (const change of changeRows) {
        const row = (await query(
          'SELECT updated_at FROM items WHERE id = ? AND profile = ?',
          [change.id, change.profile]
        ))[0];
        if (row && row.updated_at === change.updated_at) {
          await exec(
            'UPDATE items SET dirty = 0 WHERE id = ? AND profile = ?',
            [change.id, change.profile]
          );
        }
      }
    }

    if (currentTab === 'settings') render();
  } catch (err) {
    await setSyncState('last_error', err.message || 'Sync failed');
  }
}

elements.unlockBtn.addEventListener('click', unlockDb);
elements.retryBtn.addEventListener('click', unlockDb);

for (const btn of document.querySelectorAll('#nav button')) {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
}

elements.taskToggle.addEventListener('click', () => {
  elements.taskToggle.classList.add('active');
  elements.noteToggle.classList.remove('active');
  currentType = 'task';
});
elements.noteToggle.addEventListener('click', () => {
  elements.noteToggle.classList.add('active');
  elements.taskToggle.classList.remove('active');
  currentType = 'note';
});

elements.workToggle.addEventListener('click', () => {
  elements.workToggle.classList.add('active');
  elements.personalToggle.classList.remove('active');
  localStorage.setItem('assistant-profile', 'work');
});
elements.personalToggle.addEventListener('click', () => {
  elements.personalToggle.classList.add('active');
  elements.workToggle.classList.remove('active');
  localStorage.setItem('assistant-profile', 'personal');
});

const savedProfile = localStorage.getItem('assistant-profile') || 'work';
if (savedProfile === 'personal') {
  elements.personalToggle.classList.add('active');
  elements.workToggle.classList.remove('active');
}

elements.saveBtn.addEventListener('click', saveCapture);

elements.settingsSave.addEventListener('click', async () => {
  await setSyncState('hub_url', elements.hubUrl.value.trim());
  await setSyncState('device_key', elements.deviceKey.value.trim());
  await renderSettings();
});

elements.syncNow.addEventListener('click', sync);

const filterProfiles = ['all', 'work', 'personal'];
elements.filters.innerHTML = filterProfiles.map(p =>
  `<button class="filter-chip ${p === 'all' ? 'active' : ''}" data-profile="${p}">${p.charAt(0).toUpperCase() + p.slice(1)}</button>`
).join('');

for (const btn of elements.filters.querySelectorAll('button')) {
  btn.addEventListener('click', () => {
    elements.filters.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentProfile = btn.dataset.profile;
    renderToday();
    resetLockTimer();
  });
}

document.addEventListener('click', async (e) => {
  const target = e.target;
  if (target.classList.contains('done-btn')) {
    const row = target.closest('.task-row');
    if (row) {
      const id = row.dataset.id;
      const profile = row.dataset.profile;
      const now = Date.now();
      await exec(
        `UPDATE items SET status = ?, dirty = 1, updated_at = ?, field_times = ?
         WHERE id = ? AND profile = ?`,
        ['done', now, JSON.stringify({ status: now }), id, profile]
      );
      renderToday();
      sync();
      resetLockTimer();
    }
  } else if (target.classList.contains('snooze-btn')) {
    const row = target.closest('.task-row');
    if (row) {
      const id = row.dataset.id;
      const profile = row.dataset.profile;
      const next09 = nextNine();
      const now = Date.now();
      await exec(
        `UPDATE items SET at = ?, dirty = 1, updated_at = ?, field_times = ?
         WHERE id = ? AND profile = ?`,
        [next09, now, JSON.stringify({ at: now }), id, profile]
      );
      renderToday();
      sync();
      resetLockTimer();
    }
  } else if (target.classList.contains('delete-btn')) {
    const item = target.closest('.note-item');
    if (item) {
      const id = item.dataset.id;
      const profile = item.dataset.profile;
      const now = Date.now();
      await exec(
        `UPDATE items SET deleted = 1, dirty = 1, updated_at = ?, field_times = ?
         WHERE id = ? AND profile = ?`,
        [now, JSON.stringify({ deleted: now }), id, profile]
      );
      renderNotes();
      sync();
      resetLockTimer();
    }
  }
});

function nextNine() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
  return next.getTime();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    resetLockTimer();
  } else {
    if (lockTimer) clearTimeout(lockTimer);
    unlockDb();
  }
});

unlockDb();
