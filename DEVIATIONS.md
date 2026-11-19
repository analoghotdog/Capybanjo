# DEVIATIONS.md — how this build differs from the build plan

The build plan (banjo-practice-app-build-steps.md) assumes one step per short
run, one commit per step. The owner authorized a faster path: build the whole
app in a few large passes and record every difference. This file is that
record. Nothing in Part E (out of scope) was built.

## 1. Build protocol (main deviation)

- All 53 steps were completed in **one extended run in seven passes**:
  1. scaffold + tab model + roll library + scheduler + core tests
  2. four parallel pure-logic work packages (audio DSP, tab parsers, feature
     logic, storage) built against fixed API contracts while the shell, audio
     engine and UI were built concurrently
  3. audio engine (context, synth, metronome, player, capture, calibration)
  4. tab renderer, feature glue, UI views, app shell
  5. PWA (manifest, icons, service worker, update banner) + README
  6. verification (full test suite + parse-check of every source file)
  7. documentation (this file + PROGRESS.md)
- PROGRESS.md contains one entry per step as required, written at the end of
  the run rather than after each step. Git history contains one commit
  (`Steps 1-53: full build`) instead of 53 step commits, because the steps were
  not separable in time. Per-step authorship is recorded in PROGRESS.md.
- Step-ordering inside a pass followed the dependency graph (pure modules and
  tests first, then the browser layers), not the numeric order of Part D.
  Every "Done when" condition was still checked (automated where testable,
  otherwise listed in the manual checklist in README.md).

## 2. File additions (beyond the C1 folder layout)

| File | Why |
|---|---|
| `src/audio/player.js` | Tab playback engine (Steps 14-16); C1 names no file for playback and it must share the scheduler. |
| `src/audio/recorder-worklet.js` | AudioWorklet PCM collector (Step 19); a worklet must be its own module file. |
| `src/ui/dom.js` | Tiny DOM helper (`el`, `select`, `slider`) shared by the view files. |
| `scripts/gen-icons.mjs` | Step 8 asks for icons "produced from an SVG with a script or drawn as simple PNGs"; this script draws them into PNGs with a minimal built-in PNG encoder (no libraries). |
| `scripts/check-syntax.mjs` | Parse-check of every source file without executing (Step 53 audit support; browser modules cannot run in Node). |
| `tests/fake-db.js`, `tests/signal-fixtures.js`, `tests/fixtures/*` | Test helpers and fixtures (storage round-trip, synthetic signals, parser samples). |
| `DEVIATIONS.md` | This record. |

No other files exist; the C1 layout is otherwise complete.

## 3. Steps combined into single implementations

Implemented together where one feature naturally spans several steps (each
step's checks are listed in PROGRESS.md):

- Steps 4-7: metronome engine, its UI, subdivisions/meters, tap tempo and
  count-in (one `metronome.js` + one view).
- Steps 12-16: renderer, synth, playback, cursor, loop/mix (renderer + player +
  Tab view).
- Steps 18-27: capture, recording, onsets, overlay, calibration, scoring,
  report, timeline, evenness, measure replay (one Record view + `capture.js`,
  `onset.js`, `calibration.js`, `timing-report.js`).
- Steps 34-40: paste, file/drop, library, MusicXML UI, link import, rights
  note (one Import view).
- Steps 41-43: speed trainer logic + UI + auto-clean (one module + Tab view).
- Steps 44-45: alignment + tab-mode scoring (one `alignment.js` + Record view).
- Steps 49-50: chord data/diagrams + drill (`chords.js` + Chords view).
- Steps 51-52: settings + keyboard/accessibility (Settings view + app shell).

## 4. Design decisions the plan left open

1. **Beat unit.** Tab `startBeat`, the scheduler beat and the metronome grid
   all use the time-signature denominator as the beat unit (4/4 -> 4 beats per
   bar, 6/8 -> 6 eighth-beats per bar). BPM is the rate of that unit. This is
   the only convention that keeps tab playback and the click aligned in 6/8.
   (`beatsPerMeasure` returns the numerator.)
2. **Scheduler listeners.** `createScheduler` keeps the plan's injectable
   clock, `onSchedule(time, beatInfo)` callbacks, 100 ms lookahead and 25 ms
   pump, and adds `subscribe()` (multiple listeners: metronome, player and
   views share one scheduler) and `useTimer: false` for Node tests.
3. **Frequency table location.** String/fret -> frequency lives in
   `src/tab/model.js` (`stringFretToFreq`) next to the tuning table;
   `synth.js` is synthesis only.
4. **Playback looping.** The player rebases its beat origin at the loop
   boundary instead of restarting the scheduler (tempo changes stay correct).
5. **Scoring matching.** One-to-one dynamic-programming matching of detected
   onsets to expected notes/grid times (tolerance default 250 ms), with missed
   and extra counts; `stdMs` is the sample standard deviation (documented in
   `timing-report.js`).
6. **Timeline (Step 25).** Late markers are drawn to the right of a grid line,
   early markers to the left, with numeric millisecond labels and early/late
   words (never colour alone).
7. **Auto-clean pass (Step 43).** Clean = no missed expected notes, at most 2
   extra onsets, and consistency within the clean threshold (default 20 ms,
   configurable in Settings).
8. **Chord-drill mic confirm (Step 50).** Confirms a change when a detected
   pitch is within 60 cents of any chord tone (full chord recognition is out of
   scope).
9. **Tab.userNote.** The Step 36 free-text "notes" field is called `userNote`
   so it cannot collide with `notes` (the note array, C3).
10. **String mapping in the Import confirmation.** Line order (string 1 at
    top/bottom) is offered as a preset; per-line label mapping is supported by
    the parser (`options.stringMap`) but not exposed as a UI control.

## 5. Conventions and defaults worth knowing

- Click pitches: G6 accent on beat one, C6 beats, G5 subdivisions.
- Count-in clicks are slightly louder and the indicator marks them dashed.
- Recordings are stored as WAV Blobs (mono 16-bit), capped per exercise
  (default 20, configurable).
- Calibration warns above 10 ms jitter and recommends wired headphones.
- ASCII imports are marked `rhythmUnknown` and spaced evenly at the chosen
  rhythm step (default eighth notes).
- MusicXML: first part only; `.mxl` refused with an export-uncompressed
  message; pitches without string/fret data are mapped to the nearest fret and
  flagged `ambiguous` for confirmation in the import screen.

## 6. Verification status at hand-off

- `node --test tests/*.test.mjs` — see PROGRESS.md final entry for the count.
- `node --experimental-vm-modules scripts/check-syntax.mjs` — all sources parse.
- Manual checks needing a real browser/microphone/instrument are listed in
  README.md ("Manual test checklist") and in the OWNER CHECK entries of
  PROGRESS.md. Nothing in that list has been run by the agent; it requires the
  owner's device, ears and banjo.
