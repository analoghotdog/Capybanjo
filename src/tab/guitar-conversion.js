import { noteToMidi, resolveTuning } from './model.js';

export const GUITAR_TUNINGS = {
  standard: {
    label: 'Standard (E A D G B E)',
    strings: { 1: 'E4', 2: 'B3', 3: 'G3', 4: 'D3', 5: 'A2', 6: 'E2' },
  },
  dropD: {
    label: 'Drop D (D A D G B E)',
    strings: { 1: 'E4', 2: 'B3', 3: 'G3', 4: 'D3', 5: 'A2', 6: 'D2' },
  },
  dadgad: {
    label: 'DADGAD (D A D G A D)',
    strings: { 1: 'D4', 2: 'A3', 3: 'G3', 4: 'D3', 5: 'A2', 6: 'D2' },
  },
};

const OCTAVE_OFFSETS = [0, 12, -12, 24, -24, 36, -36];

export function createGuitarNoteMapper(sourceTuningKey, targetTuning, maxFret = 22) {
  const sourceTuning = GUITAR_TUNINGS[sourceTuningKey];
  if (!sourceTuning) throw new Error(`Unknown guitar tuning: ${sourceTuningKey}`);
  if (!Number.isInteger(maxFret) || maxFret < 0) throw new Error('maxFret must be a non-negative integer');

  const target = resolveTuning(targetTuning);
  const targetMidis = Object.fromEntries(
    [1, 2, 3, 4, 5].map((string) => [string, noteToMidi(target.strings[string])]),
  );
  const usedStrings = new Map();
  let shiftedNotes = 0;
  let droppedNotes = 0;

  function mapNote(note) {
    let midi = note.midi;
    if (!Number.isFinite(midi) && Number.isInteger(note.string) && note.string >= 1 && note.string <= 6
      && Number.isInteger(note.fret) && note.fret >= 0) {
      const open = sourceTuning.strings[note.string];
      if (open) midi = noteToMidi(open) + note.fret;
    }
    if (!Number.isFinite(midi)) {
      droppedNotes++;
      return null;
    }

    const timeKey = note.startBeat;
    let used = usedStrings.get(timeKey);
    if (!used) {
      used = new Set();
      usedStrings.set(timeKey, used);
    }

    for (const octaveShift of OCTAVE_OFFSETS) {
      const shiftedMidi = midi + octaveShift;
      const choices = [];
      for (const string of [1, 2, 3, 4, 5]) {
        const fret = shiftedMidi - targetMidis[string];
        if (fret >= 0 && fret <= maxFret && !used.has(string)) choices.push({ string, fret });
      }
      choices.sort((a, b) => a.fret - b.fret || a.string - b.string);
      if (choices.length) {
        const choice = choices[0];
        used.add(choice.string);
        if (octaveShift !== 0) shiftedNotes++;
        return { ...choice, octaveShift: octaveShift / 12 };
      }
    }

    droppedNotes++;
    return null;
  }

  return {
    mapNote,
    getStats() { return { shiftedNotes, droppedNotes }; },
  };
}
