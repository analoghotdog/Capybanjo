// App shell: hash router, shared services (audio, scheduler, metronome, player,
// storage, settings, practice log), service worker registration with an update
// banner, backup reminder, and global keyboard dispatch to the active view.

import { getAudioContext, ensureAudio, initAudioOnGesture } from './audio/context.js';
import { createScheduler } from './audio/scheduler.js';
import { createMetronome } from './audio/metronome.js';
import { createPlayer } from './audio/player.js';
import { openDb } from './storage/db.js';
import { logEntry, ensureSession } from './features/practice-log.js';
import { mountMetronome } from './ui/metronome.js';
import { mountPractice } from './ui/practice.js';
import { mountTab } from './ui/tab.js';
import { mountRecord } from './ui/record.js';
import { mountTuner } from './ui/tuner.js';
import { mountChords } from './ui/chords.js';
import { mountLog } from './ui/log.js';
import { mountImport } from './ui/import.js';
import { mountSettings, applyTheme } from './ui/settings.js';

const clock = {
  now() {
    try { return getAudioContext().currentTime; } catch { return 0; }
  },
};

const scheduler = createScheduler({ clock });
const metronome = createMetronome({ scheduler, getCtx: getAudioContext });
const player = createPlayer({ scheduler, getCtx: getAudioContext });

function createSettings(getDb) {
  const cache = new Map();
  let ready = null;
  async function load() {
    if (!ready) {
      ready = getDb().then((db) => db.getAll('settings')).then((items) => {
        for (const it of items) cache.set(it.id, it.value);
      });
    }
    return ready;
  }
  return {
    async get(key, fallback) {
      await load();
      return cache.has(key) ? cache.get(key) : fallback;
    },
    async set(key, value) {
      await load();
      cache.set(key, value);
      const db = await getDb();
      await db.put('settings', { id: key, value });
      app.bus.emit('settings-changed', { key, value });
    },
    async all() {
      await load();
      return Object.fromEntries(cache);
    },
  };
}

const bus = {
  handlers: new Map(),
  on(evt, fn) {
    if (!this.handlers.has(evt)) this.handlers.set(evt, new Set());
    this.handlers.get(evt).add(fn);
    return () => this.handlers.get(evt).delete(fn);
  },
  emit(evt, data) {
    for (const fn of this.handlers.get(evt) || []) fn(data);
  },
};

let dbPromise = null;
async function getDb() {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

const app = {
  getCtx: getAudioContext,
  ensureAudio,
  scheduler,
  metronome,
  player,
  settings: createSettings(getDb),
  getDb,
  bus,
  navigate(hash) { location.hash = hash; },
  async logPractice(entry) {
    const db = await getDb();
    await ensureSession(db);
    return logEntry(db, entry);
  },
};

// ---- Router ---------------------------------------------------------------

const routes = {
  practice: mountPractice,
  metronome: mountMetronome,
  tab: mountTab,
  record: mountRecord,
  tuner: mountTuner,
  chords: mountChords,
  log: mountLog,
  import: mountImport,
  settings: mountSettings,
};

const viewRoot = document.getElementById('view');
let active = null;
let activeName = null;

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '').split('?')[0];
  return routes[hash] ? hash : 'practice';
}

function render() {
  const name = currentRoute();
  if (active && active.unmount) {
    try { active.unmount(); } catch (e) { console.error('unmount failed', e); }
  }
  viewRoot.innerHTML = '';
  activeName = name;
  active = routes[name](viewRoot, app) || null;
  for (const a of document.querySelectorAll('#nav a')) {
    a.classList.toggle('active', a.getAttribute('href') === `#/${name}`);
    if (a.classList.contains('active')) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  viewRoot.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);
if (!location.hash) location.hash = '#/practice';
render();

// ---- Global keyboard shortcuts (dispatched to the active view) -------------

window.addEventListener('keydown', (e) => {
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  if (typing && e.key !== 'Escape') return;
  if (active && typeof active.onKey === 'function') {
    const handled = active.onKey(e);
    if (handled) e.preventDefault();
  }
});

// ---- Audio on first gesture ------------------------------------------------

initAudioOnGesture();

// ---- Service worker + update banner ---------------------------------------

const updateBanner = document.getElementById('banner-update');
document.getElementById('banner-update-dismiss').addEventListener('click', () => {
  updateBanner.hidden = true;
});

function showUpdateBanner(registration) {
  updateBanner.hidden = false;
  const btn = document.getElementById('banner-update-reload');
  btn.onclick = () => {
    updateBanner.hidden = true;
    // The user asked for the update: allow the controller change to reload.
    reloadRequested = true;
    if (registration && registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
      location.reload();
    }
  };
}

// Never reload automatically: an update must not interrupt a recording.
let reloadRequested = false;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(reg);
        });
      });
    }).catch((err) => console.error('service worker registration failed', err));

    let refreshed = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshed || !reloadRequested) return;
      refreshed = true;
      location.reload();
    });
  });
}

// ---- Backup reminder (30 days) --------------------------------------------

const backupBanner = document.getElementById('banner-backup');
document.getElementById('banner-backup-dismiss').addEventListener('click', () => {
  backupBanner.hidden = true;
});

async function checkBackupAge() {
  try {
    const last = await app.settings.get('lastBackupAt', null);
    const dismissed = await app.settings.get('backupBannerDismissedAt', null);
    const now = Date.now();
    const age = last ? now - Date.parse(last) : Infinity;
    const dismissedAge = dismissed ? now - Date.parse(dismissed) : Infinity;
    if (age > 30 * 24 * 3600 * 1000 && dismissedAge > 24 * 3600 * 1000) {
      backupBanner.hidden = false;
      document.getElementById('banner-backup-dismiss').onclick = () => {
        backupBanner.hidden = true;
        app.settings.set('backupBannerDismissedAt', new Date().toISOString());
      };
    }
  } catch { /* storage not ready yet */ }
}
checkBackupAge();
bus.on('backup-exported', () => { backupBanner.hidden = true; });

// ---- Theme (Settings) ------------------------------------------------------

app.settings.get('theme', 'system').then(applyTheme);
bus.on('settings-changed', ({ key, value }) => {
  if (key === 'theme') applyTheme(value);
});

export { app };
