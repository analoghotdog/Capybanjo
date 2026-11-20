// Tab playback engine: schedules a tab's notes through the shared scheduler and
// the Karplus-Strong synth. Supports count-in, looping a measure region, and
// emits cursor events. See build plan Steps 14-16.
// NOTE: this file is an addition to the C1 folder layout (see DEVIATIONS.md).

import { resolveTuning, stringFretToFreq, beatsPerMeasure, measureCount, sortedNotes } from '../tab/model.js';
import { playNote } from './synth.js';

/**
 * @param {{ scheduler, getCtx, output? }} opts
 *   Shared scheduler drives all timing; the player only turns ticks into
 *   scheduled synth notes and a cursor queue for the UI.
 */
export function createPlayer({ scheduler, getCtx, output = null }) {
  let tab = null;
  let notes = [];
  let playing = false;
  let volume = 0.8;
  let muted = false;
  let loop = null; // { startMeasure, endMeasure } or null (whole tab)
  let countInBars = 0;
  let origin = 0; // schedulerBeat = tabBeat + origin
  let pointer = 0; // next note index to schedule (notes sorted by startBeat)
  let cursorQueue = []; // { time, index, note } sorted by time
  let active = [];
  let tickUnsub = null;

  function region() {
    const measures = measureCount(tab);
    const bpm = beatsPerMeasure(tab.timeSignature);
    const startM = loop ? Math.max(0, Math.min(loop.startMeasure, measures - 1)) : 0;
    const endM = loop ? Math.max(startM, Math.min(loop.endMeasure, measures - 1)) : measures - 1;
    return { fromBeat: startM * bpm, toBeat: (endM + 1) * bpm, wrapBeat: startM * bpm };
  }

  function scheduleNote(time, note, index) {
    const ctx = getCtx();
    const freq = stringFretToFreq(resolveTuning(tab.tuning), note.string, note.fret);
    const handle = playNote(ctx, freq, time, muted ? 0 : volume, output, {
      duration: Math.max(0.6, note.durationBeats * 0.9),
    });
    active.push(handle);
    cursorQueue.push({ time, index, note });
  }

  function handleTick(time, info) {
    if (!playing || !tab) return;
    const beatDur = 60 / info.bpm;
    const tickBeat = info.tick / info.subdivision;
    const nextTickBeat = (info.tick + 1) / info.subdivision;
    const { toBeat, wrapBeat } = region();

    // Schedule every not-yet-scheduled note whose scheduler beat falls in this
    // tick's span. The pointer makes scheduling exactly-once.
    while (pointer < notes.length) {
      const n = notes[pointer];
      const sb = n.startBeat + origin;
      if (sb >= nextTickBeat - 1e-9) break;
      if (sb >= tickBeat - 1e-9) {
        scheduleNote(time + (sb - tickBeat) * beatDur, n, pointer);
      }
      pointer += 1;
    }

    // End of loop region: rebase so the region restarts on the next tick.
    if (nextTickBeat - origin >= toBeat - 1e-9) {
      origin += toBeat - wrapBeat;
      pointer = notes.findIndex((n) => n.startBeat >= wrapBeat - 1e-9);
      if (pointer < 0) pointer = notes.length;
    }
  }

  return {
    /** Start scheduling `nextTab`. Call scheduler.start() separately. */
    play(nextTab, options = {}) {
      tab = nextTab;
      notes = sortedNotes(nextTab);
      countInBars = options.countInBars ?? 0;
      loop = options.loop ?? null;
      const { fromBeat } = region();
      cursorQueue = [];
      active = [];
      // Tab beat `fromBeat` aligns with the first tick after the count-in.
      origin = countInBars * (options.beatsPerBar ?? 4) - fromBeat;
      pointer = notes.findIndex((n) => n.startBeat >= fromBeat - 1e-9);
      if (pointer < 0) pointer = notes.length;
      playing = true;
      if (!tickUnsub) tickUnsub = scheduler.subscribe(handleTick);
    },
    stop() {
      playing = false;
      for (const h of active) h.stop();
      active = [];
      cursorQueue = [];
      pointer = 0;
      origin = 0;
      if (tickUnsub) { tickUnsub(); tickUnsub = null; }
    },
    isPlaying: () => playing,
    setVolume(v) { volume = Math.min(1, Math.max(0, v)); },
    getVolume: () => volume,
    setMuted(m) { muted = !!m; },
    isMuted: () => muted,
    setLoop(regionOrNull) { loop = regionOrNull; },
    getLoop: () => loop,
    /** Most recent cursor entry at audio time `now`, or null. For rAF use. */
    currentNote(now) {
      let current = null;
      for (const e of cursorQueue) {
        if (e.time <= now) current = e;
        else break;
      }
      return current;
    },
    cursorQueue: () => cursorQueue,
  };
}
