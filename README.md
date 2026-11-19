# Banjo Practice

An offline-first practice app for 5-string banjo: a metronome, tab playback of
roll exercises, timing assessment against the click, a tuner, chord diagrams
and drills, a practice log with trends, and tab import (paste, file, link).

Runs entirely in the browser. After the first visit it works with the network
disconnected. The only feature that ever contacts the network is "import tab
from link", and only for the exact URL you enter. There is no AI, no cloud
service and no account: recordings, logs and imported tabs live in your
browser's IndexedDB only.

## Features

- **Metronome**: 30-240 BPM, tap tempo, count-in (0/1/2 bars), quarter/eighth/
  triplet/sixteenth subdivisions, 4/4, 3/4 and 6/8 meters, click volume and
  mute, visual beat indicator, keyboard control (space, arrows, M).
- **Tab**: roll exercises from an editable library, SVG tab rendering with
  finger labels, playback with cursor, loop region, independent click and tab
  volumes, per-string test tones, and a speed trainer that can judge clean
  passes automatically with the microphone.
- **Record**: microphone level meter, calibration (offset and jitter per device
  pair), assessment runs against the click (grid mode) or against an exercise
  (tab mode) with missed/extra note reporting, waveform with onset markers,
  sensitivity controls, deviation report table, timeline, plain-language
  summary, and per-measure looped replay.
- **Tuner**: live pitch with note name, cents and needle, presets (open G,
  double C, sawmill/G modal, open D, custom), closest-string highlighting with
  the short 5th string marked, per-string reference tones.
- **Chords**: open G chord diagrams and a chord-change drill prompted by the
  beat, with optional microphone confirmation.
- **Log**: practice sessions (started on your first action, closed after 15
  minutes idle), session details, and a trend chart of best clean BPM per
  exercise.
- **Import**: ASCII tab paste/upload/drop, uncompressed MusicXML
  (`.musicxml`/`.xml`), and link import (raw GitHub and Gist links work; most
  tab sites do not allow fetching and the app shows a copy-paste fallback).
  Confirmation screen with title, tuning, time signature, line order, rhythm
  step and ambiguous-fret resolution; saved-tab library with rename, notes and
  delete.
- **Backup**: export/import all data as JSON (optionally with recordings),
  merge or replace on import, and a gentle 30-day backup reminder.

## Running locally

No build step. Serve the folder over HTTP (ES modules and service workers do
not work from `file://`):

```
cd banjo-practice-app
python -m http.server 8000
```

Open `http://localhost:8000/` in current Chrome or Edge on Windows desktop.

## Deploying to GitHub Pages

1. Create a GitHub repository and push this folder's contents to it.
2. In the repository settings, enable GitHub Pages from the branch root
   (project site). The app uses only relative paths, so it works under
   `https://<user>.github.io/<repo-name>/`.
3. Open the Pages URL. Chrome's install option appears once the service worker
   has installed. Install it, then disconnect the network and reload: the app
   must still work.

Do not commit personal data: recordings, practice logs, calibrations, backup
files, or copyrighted tab. All of that stays in the browser (IndexedDB). The
only tab data in the repository is the roll library, which is original
pattern data.

## Bumping the cache version

When you change any file, update the cache name in `sw.js`:

```
const CACHE = 'banjo-v2';   // was 'banjo-v1'
```

Also add any new source files to the `PRECACHE` list in `sw.js`. On the next
load the new worker installs and the page shows "Update available. Reload".
Old caches are deleted automatically on activation.

## Editing the roll library

Rolls are data, not code: edit `src/tab/library/rolls.json`. Each roll has a
pattern of strings (1-5) and fingers (T/I/M), a measure count, tuning and time
signature. `src/tab/library.js` expands the pattern into eighth notes. Teachers
vary slightly in these patterns — check them against your own teaching
material and adjust the JSON. The same applies to the chord shapes in
`src/features/chords.js`.

## Backing up your data

Settings has "Export backup (JSON)". Recordings are only included when the
checkbox is ticked (they are large). Import accepts merge or replace mode and
checks the schema version. Keep backup files out of the repository.

## Running the tests

Pure-logic modules (scheduler, tab model, parsers, onset detection, YIN pitch,
scoring, alignment, speed trainer, backup round-trip) are tested in Node 22:

```
node --test tests/*.test.mjs
node --experimental-vm-modules scripts/check-syntax.mjs   # parse-check all sources
node scripts/check-precache.mjs                           # sw.js precache completeness
node scripts/gen-icons.mjs                                # regenerate icons
```

## Manual test checklist (release)

1. Fresh load: navigation shows all eight views; each route renders.
2. Metronome: steady click at 60 and 120 BPM, higher pitch on beat one;
   tap tempo; count-in plays before "go"; space toggles.
3. Tab: each roll renders with finger labels; playback cursor follows the
   audio; loop region loops; volumes are independent; string tests sound right.
4. PWA: install prompt appears; after install, disconnect network and reload —
   everything still works; changing the cache version shows the update banner.
5. Record: meter responds to sound; clipping warning appears when loud;
   calibration runs 16 clicks and persists after reload; a recorded run shows a
   report table and timeline that agree; measure replay loops.
6. Tuner: an open string shows in tune within a few cents; reference tones
   match the targets.
7. Chords: diagrams render for all chords; the drill prompts changes on the
   beat and logs the session.
8. Log: sessions and trend chart render after reload.
9. Import: a pasted ASCII tab previews and saves; a dropped `.txt` file works;
   a `.mxl` file shows the uncompressed-export message; a raw GitHub link
   imports; a non-CORS URL shows the copy-paste fallback without breaking.
10. Backup: export produces JSON; replace-import restores after clearing;
    the 30-day banner appears and clears after an export.
11. Audit: DevTools network tab shows no requests except the one-time page
    load (and link import when used).

## Known limits

- Rhythm of imported ASCII tab is unknown; columns are spaced evenly at the
  chosen rhythm step and the tab is marked `rhythmUnknown`.
- MusicXML import reads the first part only; `.mxl` must be exported
  uncompressed; pitches without string/fret data are mapped to the nearest
  string and flagged for confirmation.
- Timing assessment depends on your audio path; use wired headphones and run
  calibration. High jitter (>10 ms) is reported with advice.
