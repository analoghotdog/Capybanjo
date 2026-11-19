// Tab data model, tunings and validators (pure logic: no DOM, no Web Audio).
// Shape per build plan C3.

export const TUNINGS = {
  openG: {
    key: 'openG',
    name: 'Open G (gDGBD)',
    strings: { 1: 'D4', 2: 'B3', 3: 'G3', 4: 'D3', 5: 'G4' },
  },
  doubleC: {
    key: 'doubleC',
    name: 'Double C (gCGCD)',
    strings: { 1: 'D4', 2: 'C4', 3: 'G3', 4: 'C3', 5: 'G4' },
  },
  sawmill: {
    key: 'sawmill',
    name: 'Sawmill / G modal (gDGCD)',
    strings: { 1: 'D4', 2: 'C4', 3: 'G3', 4: 'D3', 5: 'G4' },
  },
  openD: {
    key: 'openD',
    name: 'Open D (f#DF#AD)',
    strings: { 1: 'D4', 2: 'A3', 3: 'F#3', 4: 'D3', 5: 'F#4' },
  },
};

export const FINGERS = ['T', 'I', 'M'];

const NOTE_OFFSETS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "D4" / "F#3" / "Bb2" -> MIDI number. */
export function noteToMidi(name) {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(String(name).trim());
  if (!m) throw new Error(`Invalid note name: ${name}`);
  const base = NOTE_OFFSETS[m[1].toUpperCase()];
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (parseInt(m[3], 10) + 1) * 12 + base + acc;
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function noteToFreq(name) {
  return midiToFreq(noteToMidi(name));
}

/** Accepts a tuning key ("openG") or a Tuning object; falls back to open G. */
export function resolveTuning(tuning) {
  if (!tuning) return TUNINGS.openG;
  if (typeof tuning === 'string') return TUNINGS[tuning] || TUNINGS.openG;
  if (tuning.strings && typeof tuning.strings === 'object') return tuning;
  return TUNINGS.openG;
}

/**
 * Frequency of a string/fret pair. The 5th string is a short string; its fret
 * numbers are relative to its own nut, so the arithmetic is the same for all
 * strings (open pitch + one semitone per fret).
 */
export function stringFretToFreq(tuning, string, fret) {
  const t = resolveTuning(tuning);
  const open = t.strings[string];
  if (open == null) throw new Error(`Tuning has no string ${string}`);
  return midiToFreq(noteToMidi(open) + fret);
}

export function validateTab(tab) {
  const errors = [];
  if (!tab || typeof tab !== 'object') return { ok: false, errors: ['tab must be an object'] };
  if (typeof tab.title !== 'string' || !tab.title.trim()) errors.push('title must be a non-empty string');
  const t = tab.tuning;
  if (typeof t === 'string') {
    if (!TUNINGS[t]) errors.push(`unknown tuning key: ${t}`);
  } else if (!t || typeof t !== 'object' || !t.strings) {
    errors.push('tuning must be a tuning key or an object with strings');
  } else {
    for (const s of [1, 2, 3, 4, 5]) {
      if (typeof t.strings[s] !== 'string') errors.push(`tuning.strings[${s}] missing`);
    }
  }
  const ts = tab.timeSignature;
  if (!Array.isArray(ts) || ts.length !== 2 || !Number.isInteger(ts[0]) || !Number.isInteger(ts[1]) || ts[0] < 1 || ts[1] < 1) {
    errors.push('timeSignature must be [integer, integer]');
  }
  if (!Array.isArray(tab.notes)) {
    errors.push('notes must be an array');
  } else {
    tab.notes.forEach((n, i) => {
      if (!n || typeof n !== 'object') { errors.push(`notes[${i}] must be an object`); return; }
      if (!Number.isInteger(n.string) || n.string < 1 || n.string > 5) errors.push(`notes[${i}].string must be 1..5`);
      if (!Number.isInteger(n.fret) || n.fret < 0) errors.push(`notes[${i}].fret must be an integer >= 0`);
      if (typeof n.startBeat !== 'number' || !(n.startBeat >= 0)) errors.push(`notes[${i}].startBeat must be >= 0`);
      if (typeof n.durationBeats !== 'number' || !(n.durationBeats > 0)) errors.push(`notes[${i}].durationBeats must be > 0`);
      if (n.finger != null && !FINGERS.includes(n.finger)) errors.push(`notes[${i}].finger must be T, I, M or null`);
    });
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Beats per measure for a [n, d] time signature. Beats are counted in the
 * denominator's unit (8/8 style): 4/4 -> 4, 3/4 -> 3, 6/8 -> 6. This matches
 * the scheduler's beat unit exactly (one beat = one denominator note), so tab
 * startBeat values line up with the metronome grid in every meter.
 */
export function beatsPerMeasure(timeSignature) {
  return timeSignature[0];
}

/** Total beats spanned by the tab (end of last note). */
export function totalBeats(tab) {
  let end = 0;
  for (const n of tab.notes) end = Math.max(end, n.startBeat + n.durationBeats);
  return end;
}

/** Number of measures the tab spans. */
export function measureCount(tab) {
  return Math.ceil(totalBeats(tab) / beatsPerMeasure(tab.timeSignature));
}

/** Notes whose onset falls inside measure m (0-based). */
export function notesInMeasure(tab, m) {
  const bpm = beatsPerMeasure(tab.timeSignature);
  const from = m * bpm;
  const to = from + bpm;
  return tab.notes.filter((n) => n.startBeat >= from - 1e-9 && n.startBeat < to - 1e-9);
}

/** Deep copy with notes sorted by startBeat (stable). */
export function sortedNotes(tab) {
  return [...tab.notes].sort((a, b) => a.startBeat - b.startBeat || a.string - b.string);
}
