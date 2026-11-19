import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TUNINGS, noteToMidi, noteToFreq, stringFretToFreq, validateTab,
  beatsPerMeasure, totalBeats, measureCount, notesInMeasure,
} from '../src/tab/model.js';

const validTab = () => ({
  id: 't1',
  title: 'Test',
  source: 'test',
  tuning: 'openG',
  timeSignature: [4, 4],
  tempoHint: 60,
  notes: [
    { string: 3, fret: 0, startBeat: 0, durationBeats: 0.5, finger: 'T' },
    { string: 2, fret: 2, startBeat: 0.5, durationBeats: 0.5, finger: 'I' },
    { string: 1, fret: 0, startBeat: 1, durationBeats: 0.5, finger: 'M' },
    { string: 5, fret: 3, startBeat: 4, durationBeats: 1, finger: null },
  ],
});

test('note name to midi and frequency', () => {
  assert.equal(noteToMidi('A4'), 69);
  assert.equal(noteToMidi('C4'), 60);
  assert.equal(noteToMidi('C#4'), 61);
  assert.equal(noteToMidi('Db4'), 61);
  assert.equal(noteToMidi('G4'), 67);
  assert.ok(Math.abs(noteToFreq('A4') - 440) < 1e-9);
  assert.ok(Math.abs(noteToFreq('D3') - 146.832) < 0.01);
  assert.throws(() => noteToMidi('H4'));
});

test('string/fret to frequency uses the tuning table', () => {
  // open G: string 3 = G3 = 196 Hz, one fret up is G#3
  const open = stringFretToFreq('openG', 3, 0);
  const fret1 = stringFretToFreq('openG', 3, 1);
  assert.ok(Math.abs(open - 195.998) < 0.01);
  assert.ok(Math.abs(fret1 / open - Math.pow(2, 1 / 12)) < 1e-9);
  // 5th string is G4 in open G
  assert.ok(Math.abs(stringFretToFreq(TUNINGS.openG, 5, 0) - 391.995) < 0.01);
});

test('validateTab accepts a valid tab', () => {
  const r = validateTab(validTab());
  assert.equal(r.ok, true, r.errors.join('; '));
});

test('validateTab rejects malformed tabs', () => {
  const cases = [
    { ...validTab(), title: '' },
    { ...validTab(), tuning: 'nope' },
    { ...validTab(), timeSignature: [4] },
    { ...validTab(), notes: 'x' },
    { ...validTab(), notes: [{ string: 9, fret: 0, startBeat: 0, durationBeats: 1, finger: 'T' }] },
    { ...validTab(), notes: [{ string: 1, fret: -1, startBeat: 0, durationBeats: 1, finger: 'T' }] },
    { ...validTab(), notes: [{ string: 1, fret: 0, startBeat: -1, durationBeats: 1, finger: 'T' }] },
    { ...validTab(), notes: [{ string: 1, fret: 0, startBeat: 0, durationBeats: 0, finger: 'T' }] },
    { ...validTab(), notes: [{ string: 1, fret: 0, startBeat: 0, durationBeats: 1, finger: 'X' }] },
  ];
  for (const c of cases) {
    const r = validateTab(c);
    assert.equal(r.ok, false, `expected invalid: ${JSON.stringify(c.notes)}`);
    assert.ok(r.errors.length > 0);
  }
});

test('measure helpers', () => {
  const tab = validTab();
  assert.equal(beatsPerMeasure([4, 4]), 4);
  assert.equal(beatsPerMeasure([6, 8]), 6);
  assert.equal(totalBeats(tab), 5);
  assert.equal(measureCount(tab), 2);
  assert.equal(notesInMeasure(tab, 0).length, 3);
  assert.equal(notesInMeasure(tab, 1).length, 1);
});
