// Service worker (build plan C8): versioned cache, precached shell and assets,
// old caches deleted on activate, "update available" handled by the page (it
// messages SKIP_WAITING when the user chooses to reload).
// Relative paths everywhere: GitHub project sites live under /<repo-name>/.

const CACHE = 'banjo-v8';

const PRECACHE = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'src/app.js',
  'src/audio/calibration.js',
  'src/audio/capture.js',
  'src/audio/context.js',
  'src/audio/metronome.js',
  'src/audio/onset.js',
  'src/audio/pitch.js',
  'src/audio/player.js',
  'src/audio/recorder-core.js',
  'src/audio/recorder-worklet.js',
  'src/audio/scheduler.js',
  'src/audio/synth.js',
  'src/features/alignment.js',
  'src/features/chords.js',
  'src/features/practice-log.js',
  'src/features/speed-trainer.js',
  'src/features/timing-report.js',
  'src/features/tuner.js',
  'src/storage/db.js',
  'src/storage/export-import.js',
  'src/tab/library.js',
  'src/tab/guitar-conversion.js',
  'src/tab/library/rolls.json',
  'src/tab/model.js',
  'src/tab/parse-ascii.js',
  'src/tab/parse-musicxml.js',
  'src/tab/render.js',
  'src/ui/chords.js',
  'src/ui/dom.js',
  'src/ui/import.js',
  'src/ui/log.js',
  'src/ui/metronome.js',
  'src/ui/practice.js',
  'src/ui/record.js',
  'src/ui/settings.js',
  'src/ui/tab.js',
  'src/ui/tuner.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // cache: 'reload' bypasses the browser HTTP cache so a stale copy can
      // never populate the new version's cache. The worker stays waiting after
      // install; it only activates when the user presses the update banner.
      cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only same-origin GET requests. Link import (the one allowed network use)
  // is a page-level fetch, not intercepted here.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch((err) => {
        // Only navigation requests fall back to the app shell. Anything else
        // (e.g. ES modules) must fail normally instead of receiving HTML.
        if (event.request.mode === 'navigate') return caches.match('index.html');
        throw err;
      });
    })
  );
});
