// Tuner helpers (pure logic: frequency comparisons only, no audio calls).
// The Tuner view wires these to YIN detection. See build plan Steps 46-48.

import { TUNINGS, resolveTuning, noteToMidi, midiToFreq } from '../tab/model.js';

/** Cents difference between a measured frequency and a target. */
export function centsOff(freq, targetFreq) {
  return 1200 * Math.log2(freq / targetFreq);
}

/** Equal-temperament note name for a frequency. */
export function noteNameFromFreq(freq) {
  const midiFloat = 69 + 12 * Math.log2(freq / 440);
  const midi = Math.round(midiFloat);
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const name = names[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return { noteName: `${name}${octave}`, midi, cents: (midiFloat - midi) * 100 };
}

/**
 * Closest target string of a tuning for a measured frequency.
 * Returns { string, name, targetFreq, cents, isFifth } or null.
 */
export function nearestTarget(freq, tuning) {
  const t = resolveTuning(tuning);
  let best = null;
  for (const key of [1, 2, 3, 4, 5]) {
    const name = t.strings[key];
    const targetFreq = midiToFreq(noteToMidi(name));
    const cents = centsOff(freq, targetFreq);
    if (!best || Math.abs(cents) < Math.abs(best.cents)) {
      best = { string: key, name, targetFreq, cents, isFifth: key === 5 };
    }
  }
  return best;
}

/** All target strings with their frequencies, for reference tones and display. */
export function targetStrings(tuning) {
  const t = resolveTuning(tuning);
  return [1, 2, 3, 4, 5].map((key) => ({
    string: key,
    name: t.strings[key],
    targetFreq: midiToFreq(noteToMidi(t.strings[key])),
    isFifth: key === 5,
  }));
}

export { TUNINGS };
