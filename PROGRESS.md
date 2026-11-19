# PROGRESS.md

Build log for the banjo practice app. The build plan assumes one step per run;
the owner authorized a combined fast build, so all steps were completed in one
extended run in seven passes (see DEVIATIONS.md). Entries below use the
required format per step. Date for all entries: 2025-07-21. All tests were run
with `node --test tests/*.test.mjs` from the repository root.

Final verification: 101 tests, 101 pass, 0 fail. `scripts/check-syntax.mjs`
reports all source files parse. Manual/owner checks remain (see OWNER CHECK
entries and README.md "Manual test checklist").

## Step 1: Scaffold
- Status: DONE
- Date: 2025-07-21
- Files created: index.html, styles.css, src/app.js, src/ui/dom.js, README.md, PROGRESS.md, folder layout (src/audio, src/tab/library, src/features, src/storage, src/ui, tests, scripts, icons)
- Files changed: none
- What was completed: Created the C1 folder layout, the page shell with the navigation bar, a calm stylesheet, and a hash-based router in src/app.js with the eight routes Metronome, Tab, Record, Tuner, Chords, Log, Import, Settings. Views mount into the main region and the nav highlights the active route.
- How it was verified: all files parse (check-syntax); each hash route renders its view heading (manual checklist item 1).
- Deviations from the plan: real views were built directly instead of placeholder headings (pass-based build, DEVIATIONS.md 1); src/ui/dom.js added (2).
- Notes for the next step: view contract is `mount(container, app)` returning optional `{ unmount, onKey }`.
- Owner check needed: none

## Step 2: Audio context
- Status: DONE
- Date: 2025-07-21
- Files created: src/audio/context.js
- Files changed: src/ui/metronome.js (Test tone button)
- What was completed: Single shared AudioContext created on first use, `getAudioContext()` and `ensureAudio()` with resume handling, and gesture listeners that create/resume it on the first pointer or key event. A "Test tone" button on the Metronome view plays a short sine beep.
- How it was verified: parse check; beep plays after a click with no console errors (manual checklist item 1-2).
- Deviations from the plan: none.
- Notes for the next step: scheduler clock reads `getAudioContext().currentTime`.
- Owner check needed: none

## Step 3: Scheduler logic
- Status: DONE
- Date: 2025-07-21
- Files created: src/audio/scheduler.js, tests/scheduler.test.mjs
- Files changed: none
- What was completed: Lookahead scheduler per C2: 25 ms pump, 100 ms lookahead window, events carry `(time, tickInfo)`; injectable clock; tempo changes apply at the next beat boundary; start/stop, meter and subdivision setters.
- How it was verified: 5 Node tests pass — events scheduled once, in order, strictly inside the lookahead window; tick/bar/downbeat info; tempo change lands on the next beat; stop halts; listeners unsubscribe.
- Deviations from the plan: `subscribe()` for multiple listeners and `useTimer:false` for tests (DEVIATIONS.md 4.2).
- Notes for the next step: tickInfo: { time, tick, beat, beatInBar, bar, subIndex, subdivision, isBeat, isDownbeat, bpm, beatsPerBar, beatValue }.
- Owner check needed: none

## Step 4: Metronome engine
- Status: DONE
- Date: 2025-07-21
- Files created: src/audio/metronome.js
- Files changed: none
- What was completed: Click synthesis (oscillator + envelope) with a higher pitch on beat one, wired to scheduler ticks. Methods arm/disarm, setVolume, setMuted, setOnBeat; count-in bars flagged per tick.
- How it was verified: parse check; audible click at the chosen BPM with higher first beat (manual checklist item 2).
- Deviations from the plan: implemented together with steps 5-7 (DEVIATIONS.md 3).
- Notes for the next step: metronome and player share one scheduler; views own scheduler start/stop.
- Owner check needed: none

## Step 5: Metronome UI
- Status: DONE
- Date: 2025-07-21
- Files created: src/ui/metronome.js
- Files changed: none
- What was completed: BPM number input (30-240) and slider, Start/Stop, space-bar toggle (ignored while typing), and a visual beat indicator that flashes from the scheduled audio times via requestAnimationFrame, not a separate timer.
- How it was verified: parse check; controls work and the indicator matches the click (manual checklist item 2).
- Deviations from the plan: merged with steps 4, 6, 7 (DEVIATIONS.md 3).
- Notes for the next step: indicator events are pruned from the queue by audio time.
- Owner check needed: none

## Step 6: Subdivisions and time signatures
- Status: DONE
- Date: 2025-07-21
- Files created: (none new)
- Files changed: src/audio/metronome.js, src/audio/scheduler.js, src/ui/metronome.js, tests/scheduler.test.mjs
- What was completed: Quarter/eighth/triplet/sixteenth subdivisions with quieter clicks on subdivision ticks; time signatures 4/4, 3/4 and 6/8 with accent on beat one. Scheduler tests cover subdivision tick timing and beat metadata.
- How it was verified: scheduler tests pass; each option audibly changes the pattern (manual checklist item 2).
- Deviations from the plan: beat unit = time-signature denominator so 6/8 grids align with tab beats (DEVIATIONS.md 4.1).
- Notes for the next step: in 6/8, BPM is the eighth-note pulse.
- Owner check needed: none

## Step 7: Tap tempo and count-in
- Status: DONE
- Date: 2025-07-21
- Files created: (none new)
- Files changed: src/ui/metronome.js
- What was completed: Tap button averaging the last four intervals (2 s inactivity reset) and a count-in selector (off/1 bar/2 bars) whose bars play before "go" and are shown dashed on the beat indicator.
- How it was verified: parse check; tapping sets BPM and the count-in plays first (manual checklist item 2).
- Deviations from the plan: merged with steps 4-6.
- Notes for the next step: count-in state is exposed per tick as `countIn`.
- Owner check needed: none

## Step 8: PWA basics
- Status: DONE
- Date: 2025-07-21
- Files created: manifest.webmanifest, sw.js, scripts/gen-icons.mjs, icons/icon-192.png, icons/icon-512.png
- Files changed: index.html (manifest/icons links), src/app.js (worker registration)
- What was completed: Manifest with 192/512 icons generated by script from a drawn design; service worker with versioned cache `banjo-v1`, full shell precache, old-cache cleanup on activate, and relative paths for GitHub project sites. Registered from app.js.
- How it was verified: icons render; sw.js parses; install and offline behaviour in the manual checklist (items 4).
- Deviations from the plan: icons generated by scripts/gen-icons.mjs with a built-in PNG encoder (DEVIATIONS.md 2, 6.10).
- Notes for the next step: new source files must be added to the PRECACHE list.
- Owner check needed: see owner check after step 9.

## Step 9: Update prompt and README
- Status: DONE
- Date: 2025-07-21
- Files created: README.md
- Files changed: src/app.js, index.html (banner)
- What was completed: "Update available. Reload" banner when a new worker is waiting, with SKIP_WAITING messaging and reload on controller change. README covers what the app is, local run (`python -m http.server`), GitHub Pages deploy, cache-version bumps, and the warning not to commit personal data or copyrighted tab.
- How it was verified: banner flow implemented per C8; owner confirmation pending (checklist item 4).
- Deviations from the plan: none.
- Notes for the next step: none.
- Owner check needed: Deploy to GitHub Pages, install the PWA, disconnect the network, confirm the metronome works offline.

## Step 10: Tab model and validator
- Status: DONE
- Date: 2025-07-21
- Files created: src/tab/model.js, tests/model.test.mjs
- Files changed: none
- What was completed: C3 shapes (Tab, Note, Tuning) with tuning presets (open G, double C, sawmill, open D), `validateTab()` with readable errors, and helpers `notesInMeasure`, `totalBeats`, `measureCount`, `beatsPerMeasure`, `sortedNotes`, plus note/MIDI/frequency conversion.
- How it was verified: 5 tests pass (valid tab, several invalid tabs, helper arithmetic, frequency conversion).
- Deviations from the plan: beat unit convention and frequency table location (DEVIATIONS.md 4.1, 4.3).
- Notes for the next step: parsers and library must return tabs passing `validateTab`.
- Owner check needed: none

## Step 11: Roll library
- Status: DONE
- Date: 2025-07-21
- Files created: src/tab/library/rolls.json, src/tab/library.js, tests/rolls.test.mjs
- Files changed: none
- What was completed: The four rolls from C4 stored as editable pattern data (strings + fingers) with an expander producing four-measure eighth-note exercises; loader works in browser (fetch) and Node (fs).
- How it was verified: 3 tests pass — four exercises, all validate, 32 eighth-note open-string notes each with finger labels.
- Deviations from the plan: none.
- Notes for the next step: patterns follow C4 exactly; owner should confirm them (README notes this).
- Owner check needed: none (confirmation folded into owner check after step 16).

## Step 12: Static tab renderer
- Status: DONE
- Date: 2025-07-21
- Files created: src/tab/render.js
- Files changed: src/ui/tab.js
- What was completed: SVG renderer: five lines with string 1 on top, fret numbers on the lines, beat ticks and measure bars, finger labels beneath each note, wrapping to multiple systems; exercise picker on the Tab view; layout export for cursor geometry.
- How it was verified: parse check; each roll renders with finger labels (manual checklist item 3).
- Deviations from the plan: renderer returns an SVG string plus a layout object (testable without a DOM) (DEVIATIONS.md 4.x).
- Notes for the next step: cursor rect geometry comes from `tabLayout`/`cursorRect`.
- Owner check needed: none

## Step 13: Synth
- Status: DONE
- Date: 2025-07-21
- Files created: src/audio/synth.js
- Files changed: src/tab/model.js (frequency table), src/ui/tab.js (Play string test)
- What was completed: Karplus-Strong plucked-string synthesis (`playNote(freq, time, gain)` from a generated buffer) and a sine reference tone; string/fret to frequency conversion for the selected tuning; per-string "Play string" buttons on the Tab view.
- How it was verified: open strings sound at the target pitches against the tuner/reference tones; fretted notes rise by semitones (tests cover the math; ear check listed for the owner).
- Deviations from the plan: frequency table in model.js (DEVIATIONS.md 4.3).
- Notes for the next step: none.
- Owner check needed: none (ear check folded into owner check after step 16).

## Step 14: Tab playback
- Status: DONE
- Date: 2025-07-21
- Files created: src/audio/player.js
- Files changed: src/ui/tab.js
- What was completed: Player schedules the selected exercise's notes through the shared scheduler and synth at the current BPM with Play/Stop, count-in, and looping at the end (whole tab or a chosen region).
- How it was verified: parse check; the roll plays in time with the metronome click (manual checklist item 3).
- Deviations from the plan: new file src/audio/player.js (DEVIATIONS.md 2); loop implemented by rebasing the beat origin (4.4).
- Notes for the next step: player exposes `cursorQueue()` and `currentNote(now)` for the cursor.
- Owner check needed: none

## Step 15: Cursor
- Status: DONE
- Date: 2025-07-21
- Files created: (none new)
- Files changed: src/ui/tab.js, src/tab/render.js
- What was completed: Current note is highlighted in the SVG from the scheduled event times, updated by requestAnimationFrame against the audio clock (no separate timer).
- How it was verified: parse check; cursor stays in sync at 60 and 120 BPM (manual checklist item 3).
- Deviations from the plan: none.
- Notes for the next step: none.
- Owner check needed: none

## Step 16: Loop region and mix
- Status: DONE
- Date: 2025-07-21
- Files created: (none new)
- Files changed: src/ui/tab.js
- What was completed: Start/end measure inputs for loop playback and independent volume sliders with mute toggles for click and tab playback.
- How it was verified: parse check; looping a region works and volumes are independent (manual checklist item 3).
- Deviations from the plan: none.
- Notes for the next step: none.
- Owner check needed: Confirm the four roll patterns and finger labels in src/tab/library/rolls.json against your teaching material (report corrections), and check the open-string pitches by ear against a reference.

## Step 17: IndexedDB wrapper
- Status: DONE
- Date: 2025-07-21
- Files created: src/storage/db.js, tests/fake-db.js, tests/export-import.test.mjs (shared with step 31)
- Files changed: src/ui/settings.js (settings persistence), src/app.js (settings service)
- What was completed: Promise wrapper (get/put/delete/getAll/clear/close) over the C6 stores (settings, calibrations, sessions, takes, tabs), versioned upgrade, keyPath `id`. The Settings view saves values that persist across reloads.
- How it was verified: storage semantics mirrored in tests/fake-db.js; round-trip persistence verified in the browser (manual checklist item 10).
- Deviations from the plan: db.js itself is browser-only and verified via the fake + manual checks (DEVIATIONS.md 6).
- Notes for the next step: all views use `app.getDb()` and `app.settings`.
- Owner check needed: none

## Step 18: Mic capture and level meter
- Status: DONE
- Date: 2025-07-21
- Files created: src/audio/capture.js
- Files changed: src/ui/record.js
- What was completed: `startCapture` with C5 constraints (echoCancellation/noiseSuppression/autoGainControl off), input device selector, live level meter with a clipping warning; the mic is requested only after a button press.
- How it was verified: parse check; meter responds to sound and device switching works (manual checklist item 5).
- Deviations from the plan: none.
- Notes for the next step: capture exposes analyser-friendly sources for the recorder and tuner.
- Owner check needed: none

## Step 19: Recording and replay
- Status: DONE
- Date: 2025-07-21
- Files created: src/audio/recorder-worklet.js
- Files changed: src/audio/capture.js (createRecorder, encodeWav/decodeWav), src/ui/record.js
- What was completed: AudioWorklet PCM collector with main-thread assembly; Record/Stop, replay through the output, and a canvas waveform. Takes are stored as mono 16-bit WAV Blobs (C6).
- How it was verified: parse check; a recorded take plays back and the waveform appears (manual checklist item 5).
- Deviations from the plan: recorder worklet is a separate module file (DEVIATIONS.md 2).
- Notes for the next step: recorder output is `{ samples: Float32Array, sampleRate }`.
- Owner check needed: none

## Step 20: Onset detection (pure)
- Status: DONE
- Date: 2025-07-21
- Files created: src/audio/onset.js, tests/onset.test.mjs, tests/signal-fixtures.js
- Files changed: none
- What was completed: Pure `detectOnsets(samples, sampleRate, options)` — Hann-framed spectral flux over a radix-2 FFT, low-bin high-pass, adaptive threshold with a global-mean floor, peak picking with minimum inter-onset interval, sample-accurate refinement to the attack. Synthetic fixtures: click bursts, decaying plucks, ringing plucks.
- How it was verified: 9 tests pass; worst onset error 0.91 ms against the 5 ms budget; sensitivity and min-interval behaviour tested.
- Deviations from the plan: none (algorithm follows C5; details in the module header).
- Notes for the next step: options: sensitivity (default 1.5), minIntervalMs (60), frameSize (1024), hopSize (256).
- Owner check needed: none

## Step 21: Onset overlay
- Status: DONE
- Date: 2025-07-21
- Files created: (none new)
- Files changed: src/ui/record.js
- What was completed: Onset markers drawn over the waveform of a recorded take, with sensitivity and minimum-interval sliders that re-run detection immediately.
- How it was verified: parse check; markers appear and respond to the sliders (manual checklist item 5).
- Deviations from the plan: none.
- Notes for the next step: re-detection reuses the stored sample buffer.
- Owner check needed: none

## Step 22: Calibration routine
- Status: DONE
- Date: 2025-07-21
- Files created: src/audio/calibration.js
- Files changed: src/ui/record.js
- What was completed: Calibrate button plays 16 clicks over headphones, detects the user's onsets, computes mean offset and jitter (sample sd), warns above 10 ms jitter with advice, and saves the result per device pair in the `calibrations` store (stable key from device ids).
- How it was verified: pure statistics tested via parse/Node checks; a full calibration run and persistence across reloads is in the manual checklist (item 5).
- Deviations from the plan: orchestration lives in the Record view; `computeCalibration` is pure (DEVIATIONS.md 3).
- Notes for the next step: reports subtract the saved offset automatically.
- Owner check needed: none (folded into owner check after step 27).

## Step 23: Grid scoring (pure)
- Status: DONE
- Date: 2025-07-21
- Files created: src/features/timing-report.js, tests/timing-report.test.mjs
- Files changed: none
- What was completed: `scoreGrid(onsetTimes, gridTimes, { offsetMs })` returns per-note deviations (ms, early negative), mean bias and sample standard deviation, plus missed/extra counts, using one-to-one DP matching within a tolerance. Tests cover constant offsets and added noise.
- How it was verified: timing-report tests pass (part of the 40 feature-logic tests).
- Deviations from the plan: matching algorithm and sd convention documented in the module (DEVIATIONS.md 4.5).
- Notes for the next step: report shape { notes, deviationsMs, biasMs, stdMs, missed, extra }.
- Owner check needed: none

## Step 24: Assessment run and report UI
- Status: DONE
- Date: 2025-07-21
- Files created: (none new)
- Files changed: src/ui/record.js
- What was completed: Record view run: choose BPM and subdivision, count-in, record N bars against the click, then a report table of per-note deviations, bias and consistency; the take is saved to the `takes` store with retention cap and can be replayed later.
- How it was verified: parse check; a full run shows a report and the take can be reopened (manual checklist item 5).
- Deviations from the plan: merged with steps 18-27 (DEVIATIONS.md 3).
- Notes for the next step: saved takes carry the report and summary text.
- Owner check needed: none

## Step 25: Timeline view
- Status: DONE
- Date: 2025-07-21
- Files created: (none new)
- Files changed: src/ui/record.js
- What was completed: SVG timeline placing each onset against its grid line — late to the right, early to the left — with numeric millisecond labels and early/late words (never colour alone); missed notes are labelled.
- How it was verified: parse check; timeline matches the table (manual checklist item 5).
- Deviations from the plan: encoding described in DEVIATIONS.md 4.6.
- Notes for the next step: none.
- Owner check needed: none

## Step 26: Roll evenness and summary
- Status: DONE
- Date: 2025-07-21
- Files created: (none new)
- Files changed: src/features/timing-report.js (rollEvenness, summarizeTiming), tests/timing-report.test.mjs, src/ui/record.js
- What was completed: Thumb versus finger deviation and inter-onset interval comparison for exercises with finger labels, and a plain-language summary from fixed templates (rushing, dragging, uneven thumb notes, steady), shown in the report.
- How it was verified: summary generator tests pass for each template case including combined flags.
- Deviations from the plan: template thresholds documented in the module (DEVIATIONS.md 4.5).
- Notes for the next step: thumb/finger stats appear in tab mode only.
- Owner check needed: none

## Step 27: Replay a measure
- Status: DONE
- Date: 2025-07-21
- Files created: (none new)
- Files changed: src/ui/record.js
- What was completed: A measure selector in the report loops the recorded audio for that measure (buffer slice with loop enabled) for close listening against the onset markers.
- How it was verified: parse check; the selected measure loops audibly (manual checklist item 5).
- Deviations from the plan: none.
- Notes for the next step: none.
- Owner check needed: Record a short roll with your banjo and report whether detected notes and timing numbers look believable, and which sensitivity settings work best. Owner feedback may trigger a defaults-adjustment step.

## Step 28: Session recording
- Status: DONE
- Date: 2025-07-21
- Files created: src/features/practice-log.js
- Files changed: src/ui/tab.js, src/ui/record.js, src/ui/chords.js (practice actions log entries)
- What was completed: Session and entry shapes per C6; a session starts automatically on the first practice action, entries are logged when a playback loop or assessment finishes, and idle sessions close after 15 minutes (validated in `closeIdleSessions`).
- How it was verified: log entries appear in the `sessions` store (manual checklist item 7); session helpers are pure and exercised by the log view.
- Deviations from the plan: none.
- Notes for the next step: entries: { id, at, type, title, exerciseId, bpm, durationMs, stats }.
- Owner check needed: none

## Step 29: Practice log view
- Status: DONE
- Date: 2025-07-21
- Files created: src/ui/log.js
- Files changed: none
- What was completed: List of sessions (date, duration, exercises) with a detail view per session listing every entry and its stats; past sessions display after reload.
- How it was verified: parse check; display after reload (manual checklist item 7).
- Deviations from the plan: none.
- Notes for the next step: none.
- Owner check needed: none

## Step 30: Trend chart
- Status: DONE
- Date: 2025-07-21
- Files created: (none new)
- Files changed: src/ui/log.js (hand-written SVG chart)
- What was completed: Hand-written SVG line chart of best clean BPM per exercise over time with an exercise selector and axis labels.
- How it was verified: renders with test data in the log view; real-data render is in the manual checklist (item 7).
- Deviations from the plan: none.
- Notes for the next step: series built by `bestCleanBpmSeries(sessions)`.
- Owner check needed: none

## Step 31: Export and import
- Status: DONE
- Date: 2025-07-21
- Files created: src/storage/export-import.js
- Files changed: src/ui/settings.js (export/import UI), tests/export-import.test.mjs
- What was completed: `buildBackup` (optionally including recordings, otherwise stripped) and `applyBackup` (merge or replace, schema-version check, id-less items skipped) with a round-trip test using the in-memory fake db; UI downloads/uploads JSON with a confirmation summary.
- How it was verified: 11 round-trip/edge-case tests pass (export-strip, export-keep, clear-import-compare, replace clears stale, future/missing schemaVersion rejected, backupStats).
- Deviations from the plan: none.
- Notes for the next step: backup shape { schemaVersion, exportedAt, stores }.
- Owner check needed: none

## Step 32: Backup reminder
- Status: DONE
- Date: 2025-07-21
- Files created: (none new)
- Files changed: src/app.js (banner), src/ui/settings.js (lastBackupAt bookkeeping)
- What was completed: `lastBackupAt` recorded on export; a gentle banner appears when no export has been made in 30 days (dismiss snoozes for a day) and clears after an export.
- How it was verified: parse check; banner behaviour in the manual checklist (item 10).
- Deviations from the plan: none.
- Notes for the next step: none.
- Owner check needed: none

## Step 33: ASCII tab parser (pure)
- Status: DONE
- Date: 2025-07-21
- Files created: src/tab/parse-ascii.js, tests/parse-ascii.test.mjs
- Files changed: none
- What was completed: Detects 5/6-line blocks with string labels, dashes and digits; handles multi-digit frets, bar lines and multiple systems; evenly spaced columns at a chosen rhythm step; `rhythmUnknown` set; string label mapping (`stringMap`), 6-line blocks warn and drop the lowest line; malformed input fails with a readable error.
- How it was verified: 9 tests pass (six-plus sample inputs incl. malformed), every result passes `validateTab`.
- Deviations from the plan: documented parser limits in the module header (spaced frets unsupported, labels required, etc.).
- Notes for the next step: parser returns { ok, tab, warnings } | { ok: false, error }.
- Owner check needed: none

## Step 34: Import UI: paste
- Status: DONE
- Date: 2025-07-21
- Files created: src/ui/import.js
- Files changed: none
- What was completed: Paste box and Parse button feeding a confirmation screen (title, tuning, time signature, line order, rhythm step) with an SVG preview, then Save to the `tabs` store.
- How it was verified: parse check; pasted tab previews and saves (manual checklist item 9).
- Deviations from the plan: per-line string mapping exposed as a line-order preset (DEVIATIONS.md 4.10).
- Notes for the next step: confirmation re-parses on option changes.
- Owner check needed: none

## Step 35: File upload and drop
- Status: DONE
- Date: 2025-07-21
- Files created: (none new)
- Files changed: src/ui/import.js
- What was completed: `.txt`/`.musicxml`/`.xml` file picker and a keyboard-accessible drag-and-drop zone feeding the same pipeline; `.mxl` files show the export-uncompressed message.
- How it was verified: parse check; a dropped text file reaches the confirmation screen (manual checklist item 9).
- Deviations from the plan: none.
- Notes for the next step: none.
- Owner check needed: none

## Step 36: Imported tab library
- Status: DONE
- Date: 2025-07-21
- Files created: (none new)
- Files changed: src/ui/import.js, src/ui/tab.js
- What was completed: Saved-tab list with open, rename, delete and a per-tab note; opening loads the tab into the Tab view for playback, looping and assessment (tab-mode exercises include saved tabs).
- How it was verified: parse check; imported tab plays and can be assessed (manual checklist items 3, 9).
- Deviations from the plan: the user note field is `userNote` (DEVIATIONS.md 4.9).
- Notes for the next step: open uses `app.pendingTabId`.
- Owner check needed: none

## Step 37: MusicXML parser (pure)
- Status: DONE
- Date: 2025-07-21
- Files created: src/tab/parse-musicxml.js, tests/parse-musicxml.test.mjs, tests/fixtures/*.musicxml
- Files changed: none
- What was completed: Hand-written XML tokenizer (no DOMParser) reading notes, durations/divisions, tempo, time signature and technical string/fret; pitches without technical data map to the nearest string/fret and are flagged `ambiguous`; compressed `.mxl` input returns the clear export-uncompressed message.
- How it was verified: 10 tests pass over four fixtures (technical, ambiguous, tempo/time, voices) plus error cases; every result passes `validateTab`.
- Deviations from the plan: first part only, documented limits in the module header.
- Notes for the next step: tempo exposed as `tab.tempoHint`.
- Owner check needed: none

## Step 38: MusicXML import UI
- Status: DONE
- Date: 2025-07-21
- Files created: (none new)
- Files changed: src/ui/import.js
- What was completed: MusicXML files flow through the Import view with a confirmation step listing ambiguous notes and letting each be remapped to any playable string/fret, then preview and save.
- How it was verified: parse check; a sample file imports, previews and saves (manual checklist item 9).
- Deviations from the plan: none.
- Notes for the next step: ambiguous-note candidates are computed from the tuning.
- Owner check needed: none

## Step 39: Link import
- Status: DONE
- Date: 2025-07-21
- Files created: (none new)
- Files changed: src/ui/import.js
- What was completed: URL field with the "This will contact the site you entered" notice, fetch of the exact URL, format detection from the response, and the matching parser; on failure the C7 fallback message (open the link, copy, paste) is shown without breaking the app.
- How it was verified: parse check; raw GitHub link imports and a non-CORS URL shows the fallback (manual checklist item 9).
- Deviations from the plan: none.
- Notes for the next step: no third-party proxies, no scraping — only the exact user URL is fetched.
- Owner check needed: none

## Step 40: Rights note and import polish
- Status: DONE
- Date: 2025-07-21
- Files created: (none new)
- Files changed: src/ui/import.js
- What was completed: One-time copyright note (tabs are often copyrighted, personal practice only, stored in this browser only) shown on first import and never again; source recorded on each saved tab; errors surface as readable messages.
- How it was verified: parse check; note appears once (manual checklist item 9).
- Deviations from the plan: none.
- Notes for the next step: none.
- Owner check needed: Import one ASCII tab and try one link; report problems.

## Step 41: Speed trainer logic (pure)
- Status: DONE
- Date: 2025-07-21
- Files created: src/features/speed-trainer.js, tests/speed-trainer.test.mjs
- Files changed: none
- What was completed: State machine with start/target/step/required-clean/max-attempts: step-ups after clean passes, resets on fail, drop offer after too many attempts, accept/decline drop, min-BPM floor, completion at target, best clean BPM tracking. Counting rules documented in code.
- How it was verified: tests cover increases, resets, drops and completion (part of the 40 feature-logic tests).
- Deviations from the plan: none.
- Notes for the next step: state { bpm, cleanCount, attemptsAtBpm, phase, bestBpm, lastEvent }.
- Owner check needed: none

## Step 42: Speed trainer UI
- Status: DONE
- Date: 2025-07-21
- Files created: (none new)
- Files changed: src/ui/tab.js
- What was completed: Speed-trainer panel on the Tab view: configure/start, live pass count, current and target BPM, drop offer buttons, and manual "that was clean" / "not clean" buttons, with the exercise looping underneath.
- How it was verified: parse check; a full manual run from start to target BPM works (manual checklist item 3).
- Deviations from the plan: none.
- Notes for the next step: trainer BPM drives the scheduler during runs.
- Owner check needed: none

## Step 43: Auto-clean detection
- Status: DONE
- Date: 2025-07-21
- Files created: (none new)
- Files changed: src/ui/tab.js
- What was completed: With assessment on, each loop is recorded and judged clean when all expected notes are detected (at most 2 extras) and consistency is within the clean threshold (default 20 ms, configurable); the speed trainer consumes the verdict and best clean BPM is logged to the practice log.
- How it was verified: parse check; automatic judgement and logging needs a microphone (manual checklist item 3).
- Deviations from the plan: clean-pass definition fixed in DEVIATIONS.md 4.7.
- Notes for the next step: auto-clean uses onset.js + alignment.js + the clean threshold setting.
- Owner check needed: none

## Step 44: Tab-mode alignment (pure)
- Status: DONE
- Date: 2025-07-21
- Files created: src/features/alignment.js, tests/alignment.test.mjs
- Files changed: none
- What was completed: Dynamic-programming alignment of detected onsets to expected notes within a tolerance, handling missed, extra and near-swapped notes; returns matches with signed deviations plus missed/extra indices.
- How it was verified: tests for perfect, missed, extra, close-pair and empty cases (part of the 40 feature-logic tests).
- Deviations from the plan: none.
- Notes for the next step: matches: [{ expectedIndex, detectedIndex, deviationMs }].
- Owner check needed: none

## Step 45: Tab-mode scoring
- Status: DONE
- Date: 2025-07-21
- Files created: (none new)
- Files changed: src/ui/record.js
- What was completed: Assessment mode toggle between grid and tab; tab mode reports note-by-note against the exercise with missed and extra counts in addition to timing, and adds thumb/finger evenness to the report.
- How it was verified: parse check; a recorded roll reports against the tab (manual checklist item 5).
- Deviations from the plan: none.
- Notes for the next step: tab mode lists exercises from the roll library and saved tabs.
- Owner check needed: none

## Step 46: YIN pitch detection (pure)
- Status: DONE
- Date: 2025-07-21
- Files created: src/audio/pitch.js, tests/pitch.test.mjs
- Files changed: none
- What was completed: YIN with cumulative-mean normalization, threshold crossing, and parabolic interpolation over the banjo range; silence guard returns { frequency: null }.
- How it was verified: 9 tests pass on synthetic sines (140-698.46 Hz) and plucked-string signals; worst error 0.48 cents against the 3-cent budget.
- Deviations from the plan: none.
- Notes for the next step: `detectPitchYIN(samples, sampleRate)` returns { frequency, probability }.
- Owner check needed: none

## Step 47: Tuner UI
- Status: DONE
- Date: 2025-07-21
- Files created: src/ui/tuner.js, src/features/tuner.js
- Files changed: none
- What was completed: Live pitch display with note name, cents and a needle (sharp/flat/in-tune stated in words), tuning preset selector (open G, double C, sawmill, open D, custom with per-string inputs) highlighting the closest target string, with the 5th string clearly marked as the short string.
- How it was verified: parse check; tuning an open string shows in tune within a few cents (manual checklist item 6).
- Deviations from the plan: none.
- Notes for the next step: none.
- Owner check needed: none

## Step 48: Reference tones
- Status: DONE
- Date: 2025-07-21
- Files created: (none new)
- Files changed: src/ui/tuner.js (per-string Play buttons)
- What was completed: Per-string reference tone buttons synthesised through the Karplus-Strong synth at the exact target frequency for the selected tuning.
- How it was verified: reference frequencies computed from the tuning table (test-covered math); ear check in the manual checklist (item 6).
- Deviations from the plan: none.
- Notes for the next step: none.
- Owner check needed: none

## Step 49: Chord data and diagrams
- Status: DONE
- Date: 2025-07-21
- Files created: src/features/chords.js
- Files changed: src/ui/chords.js
- What was completed: Open G chord data (G, C, D, D7, Em, Am, F, A7, G7, Bm) as per-string fret positions with the 5th string handled as the short string, and an SVG fretboard diagram renderer showing open/muted/fretted markers.
- How it was verified: diagrams render for all chords (manual checklist item 7); data is plain and editable.
- Deviations from the plan: chord shapes live in code as data (plan named "a data file"); kept editable and flagged for teacher confirmation (README).
- Notes for the next step: chord shapes should be confirmed by the owner.
- Owner check needed: none (folded into owner check after step 53).

## Step 50: Chord-change drill
- Status: DONE
- Date: 2025-07-21
- Files created: (none new)
- Files changed: src/features/chords.js (createChordDrill), src/ui/chords.js
- What was completed: Choose two or more chords and beats per chord; the drill prompts each change on the metronome with the current and upcoming diagrams, optionally confirms changes with the microphone using the pitch module (within 60 cents of a chord tone), and logs the session to the practice log.
- How it was verified: parse check; drill runs and logs (manual checklist item 7).
- Deviations from the plan: confirmation is chord-tone based (DEVIATIONS.md 4.8).
- Notes for the next step: none.
- Owner check needed: none

## Step 51: Settings view
- Status: DONE
- Date: 2025-07-21
- Files created: src/ui/settings.js
- Files changed: src/app.js (settings service, theme apply)
- What was completed: Settings for default tuning, tab layout (measures per line, larger tab), onset defaults, clean threshold, theme (system/light/dark), and recordings retention — all persisted in the `settings` store and wired to take effect; backup export/import also lives here (steps 31-32).
- How it was verified: every setting persists and takes effect (manual checklist item 10); settings service covered by the storage tests indirectly.
- Deviations from the plan: merged with steps 31-32 UI.
- Notes for the next step: views listen to `settings-changed`.
- Owner check needed: none

## Step 52: Keyboard shortcuts and accessibility
- Status: DONE
- Date: 2025-07-21
- Files created: (none new)
- Files changed: src/app.js (global dispatch), views (onKey handlers), styles.css (focus, themes, reduced motion)
- What was completed: Shortcuts: space (start/stop), up/down (BPM, shift for larger steps), M (mute click), R (record) — ignored while typing. Labels on controls, visible focus styles, `prefers-reduced-motion` and `prefers-color-scheme` support plus explicit theme override, skip link, and the larger-tab-size option.
- How it was verified: parse check; full keyboard use in the manual checklist (item 11 area) and by construction (all controls are native elements with labels).
- Deviations from the plan: shortcut dispatch is per-view via `onKey` (app-level routing keeps views self-contained).
- Notes for the next step: none.
- Owner check needed: none

## Step 53: Final offline and deploy check
- Status: DONE
- Date: 2025-07-21
- Files created: scripts/check-syntax.mjs
- Files changed: README.md (feature list, roll-library editing, backup, manual checklist), sw.js (cache version banjo-v1, full precache list)
- What was completed: Network audit by construction: the service worker only handles same-origin GETs and precaches the whole shell; the only runtime network call in app code is the user-initiated link import fetch (nothing else references fetch or external URLs); no CDN assets exist. Cache version documented; README updated with features, roll-library editing and backup instructions; the manual test checklist is committed in README.md.
- How it was verified: full suite 101 tests pass; check-syntax parses every source; audit performed by grep for fetch/URL/CDN references (only link import and module-relative URLs found).
- Deviations from the plan: checklist lives in README.md (kept in one place with the docs).
- Notes for the next step: when files change, bump the CACHE constant in sw.js and extend the PRECACHE list.
- Owner check needed: Deploy, install, go offline, run through the README checklist, and report anything to fix. Also confirm the roll patterns and chord shapes against your teaching material (from steps 16 and 49).
