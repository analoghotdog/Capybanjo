// F8 verification: chord-drill confirmation is a root-pitch check within
// 30 cents — deliberately not chord recognition.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chordRootName, isChordRootPitch, chordByKey, OPEN_G_CHORDS } from '../src/features/chords.js';

test('chordRootName reads the root letter from the chord key', () => {
  assert.equal(chordRootName('G'), 'G');
  assert.equal(chordRootName('D7'), 'D');
  assert.equal(chordRootName('Em'), 'E');
  assert.equal(chordRootName('Am'), 'A');
  assert.equal(chordRootName('Bm'), 'B');
});

test('the root pitch matches in any octave', () => {
  assert.equal(isChordRootPitch(195.998, 'G', 30), true, 'G3 is the root of G');
  assert.equal(isChordRootPitch(391.995, 'G', 30), true, 'G4 also counts');
  assert.equal(isChordRootPitch(261.626, 'C', 30), true);
  assert.equal(isChordRootPitch(329.628, 'Em', 30), true, 'E4 is the root of Em');
  assert.equal(isChordRootPitch(293.665, 'D7', 30), true, 'D4 is the root of D7');
});

test('non-root pitches are rejected', () => {
  assert.equal(isChordRootPitch(261.626, 'G', 30), false, 'C4 is not the root of G');
  assert.equal(isChordRootPitch(329.628, 'Am', 30), false, 'E4 is the third of Am, not the root');
  assert.equal(isChordRootPitch(0, 'G', 30), false);
  assert.equal(isChordRootPitch(196, 'nonsense', 30), false);
});

test('the 30-cent window is enforced', () => {
  const g = 195.998;
  const cents = (c) => g * Math.pow(2, c / 1200);
  assert.equal(isChordRootPitch(cents(25), 'G', 30), true, '25 cents sharp is accepted');
  assert.equal(isChordRootPitch(cents(-25), 'G', 30), true, '25 cents flat is accepted');
  assert.equal(isChordRootPitch(cents(40), 'G', 30), false, '40 cents sharp is rejected');
  assert.equal(isChordRootPitch(cents(-40), 'G', 30), false, '40 cents flat is rejected');
});

test('every chord in the library has a readable root', () => {
  for (const c of OPEN_G_CHORDS) {
    assert.ok(chordRootName(c.key), `${c.key} has a root`);
    assert.ok(chordByKey(c.key), `${c.key} resolves`);
  }
});
