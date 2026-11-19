import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseMusicXML } from '../src/tab/parse-musicxml.js';
import { validateTab } from '../src/tab/model.js';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

function assertValidTab(tab) {
  const r = validateTab(tab);
  assert.equal(r.ok, true, r.errors.join('; '));
}

/** Minimal score wrapper for inline fixtures. */
const wrap = (inner) => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Banjo</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    ${inner}
  </measure></part>
</score-partwise>`;

// ---------- 1. technical string/fret ----------

test('notes with <technical> string/fret: chords, rests, tempo default', () => {
  const r = parseMusicXML(fixture('technical.musicxml'));
  assert.equal(r.ok, true, r.error);
  assertValidTab(r.tab);
  assert.deepEqual(r.warnings, []);

  assert.equal(r.tab.title, 'Technical Fixture'); // from <work-title>
  assert.equal(r.tab.source, 'MusicXML import');
  assert.equal(r.tab.tuning, 'openG');
  assert.deepEqual(r.tab.timeSignature, [4, 4]);
  assert.equal(r.tab.rhythmUnknown, false);
  assert.equal(r.tab.tempo, 120); // no tempo in file -> default
  assert.equal(r.tab.tempoHint, 120);

  // divisions=2: quarter=1 beat, eighth=0.5 beats. The rest occupies 0.5
  // beats; the chord shares the onset of its first note and the chord pair
  // occupies one beat together.
  assert.deepEqual(r.tab.notes, [
    { string: 1, fret: 0, startBeat: 0, durationBeats: 1, finger: null },
    { string: 1, fret: 2, startBeat: 1, durationBeats: 0.5, finger: null },
    { string: 3, fret: 0, startBeat: 2, durationBeats: 1, finger: null },
    { string: 4, fret: 0, startBeat: 2, durationBeats: 1, finger: null },
    { string: 5, fret: 0, startBeat: 3, durationBeats: 1, finger: null },
  ]);
});

// ---------- 2. pitch mapping without technical data ----------

test('notes without <technical> map from pitch and are marked ambiguous', () => {
  const r = parseMusicXML(fixture('ambiguous.musicxml'));
  assert.equal(r.ok, true, r.error);
  assertValidTab(r.tab);

  // openG: s1=D4 s2=B3 s3=G3 s4=D3 s5=G4. Nearest string = smallest fret >= 0.
  assert.deepEqual(r.tab.notes, [
    { string: 1, fret: 0, startBeat: 0, durationBeats: 1, finger: null, ambiguous: true },
    { string: 3, fret: 0, startBeat: 1, durationBeats: 1, finger: null, ambiguous: true },
    { string: 2, fret: 0, startBeat: 2, durationBeats: 1, finger: null, ambiguous: true },
    { string: 5, fret: 0, startBeat: 3, durationBeats: 1, finger: null, ambiguous: true },
    { string: 4, fret: 0, startBeat: 4, durationBeats: 1, finger: null, ambiguous: true },
    { string: 3, fret: 2, startBeat: 5, durationBeats: 1, finger: null, ambiguous: true },
  ]);

  // A3 on the 3rd string (fret 2) beats the 4th string (fret 7): smallest fret
  // wins. C3 is below every open string in open G and is dropped with a warning.
  const ambiguousWarning = r.warnings.find((w) => /ambiguous/.test(w));
  assert.ok(ambiguousWarning, `missing ambiguous warning in: ${JSON.stringify(r.warnings)}`);
  assert.match(ambiguousWarning, /6/, 'the warning lists the count of ambiguous notes');
  assert.ok(r.warnings.some((w) => /below every open string/.test(w)));
});

// ---------- 3. tempo + time signature ----------

test('<sound tempo> wins over metronome; <time> is read', () => {
  const r = parseMusicXML(fixture('tempo-time.musicxml'));
  assert.equal(r.ok, true, r.error);
  assertValidTab(r.tab);
  assert.equal(r.tab.tempo, 96);
  assert.equal(r.tab.tempoHint, 96);
  assert.deepEqual(r.tab.timeSignature, [3, 4]);
  assert.equal(r.tab.title, 'Tempo And Time');
  assert.deepEqual(r.tab.notes, [
    { string: 4, fret: 0, startBeat: 0, durationBeats: 1, finger: null },
    { string: 4, fret: 2, startBeat: 1, durationBeats: 1, finger: null },
    { string: 4, fret: 4, startBeat: 2, durationBeats: 1, finger: null },
  ]);
});

// ---------- 4. voices + backup + metronome-only tempo ----------

test('voices are positioned with backup; metronome half=60 -> 120 BPM', () => {
  const r = parseMusicXML(fixture('voices.musicxml'));
  assert.equal(r.ok, true, r.error);
  assertValidTab(r.tab);
  assert.equal(r.tab.tempo, 120); // 60 half notes/min = 120 quarter beats/min
  assert.deepEqual(r.tab.timeSignature, [4, 4]);
  assert.deepEqual(r.tab.notes, [
    { string: 1, fret: 0, startBeat: 0, durationBeats: 1, finger: null },
    { string: 3, fret: 0, startBeat: 0, durationBeats: 1, finger: null },
    { string: 2, fret: 0, startBeat: 1, durationBeats: 1, finger: null },
    { string: 4, fret: 0, startBeat: 1, durationBeats: 1, finger: null },
  ]);
});

// ---------- 5. compressed / garbage input ----------

test('compressed .mxl input is rejected with a helpful message', () => {
  const r = parseMusicXML('PK\u0003\u0004\u0014\u0000\u0000\u0000');
  assert.equal(r.ok, false);
  assert.equal(
    r.error,
    'This looks like a compressed .mxl file. Please export it as uncompressed MusicXML (.musicxml or .xml) and try again.',
  );
});

test('garbage and non-string input return ok:false', () => {
  for (const bad of ['hello world', '', '<html><body>nope</body></html>']) {
    const r = parseMusicXML(bad);
    assert.equal(r.ok, false, `expected failure for: ${bad}`);
    assert.equal(typeof r.error, 'string');
    assert.ok(r.error.length > 0);
  }
  assert.equal(parseMusicXML(42).ok, false);
});

test('a score with no notes returns ok:false', () => {
  const empty = wrap('<note><rest/><duration>1</duration></note>').replace(
    /<note>[\s\S]*?<\/note>/,
    '',
  );
  const r = parseMusicXML(empty);
  assert.equal(r.ok, false);
  assert.match(r.error, /note/i);
});

// ---------- 6. 6-string technical data ----------

test('6-string data: strings 1-5 map 1:1, string 6 is dropped with a warning', () => {
  const xml = wrap(`
    <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type>
      <technical><string>2</string><fret>3</fret></technical></note>
    <note><pitch><step>E</step><octave>2</octave></pitch><duration>1</duration><type>quarter</type>
      <technical><string>6</string><fret>0</fret></technical></note>
    <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type>
      <technical><string>5</string><fret>0</fret></technical></note>`);
  const r = parseMusicXML(xml);
  assert.equal(r.ok, true, r.error);
  assertValidTab(r.tab);
  assert.deepEqual(r.tab.notes, [
    { string: 2, fret: 3, startBeat: 0, durationBeats: 1, finger: null },
    { string: 5, fret: 0, startBeat: 2, durationBeats: 1, finger: null },
  ]);
  assert.ok(r.warnings.some((w) => /6\+/.test(w) && /1-5/.test(w)));
});

// ---------- 7. tie-break on equal frets goes to the lower string ----------

test('pitch mapping ties break to the lower string number', () => {
  const tuning = {
    key: 'unison',
    name: 'Unison test tuning',
    strings: { 1: 'D4', 2: 'D4', 3: 'G3', 4: 'D3', 5: 'G4' },
  };
  const xml = wrap(`
    <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>`);
  const r = parseMusicXML(xml, { tuning });
  assert.equal(r.ok, true, r.error);
  assertValidTab(r.tab);
  // Strings 1 and 2 are both D4 (fret 0): the lower string number wins.
  assert.deepEqual(r.tab.notes, [
    { string: 1, fret: 0, startBeat: 0, durationBeats: 1, finger: null, ambiguous: true },
  ]);
});

// ---------- 8. options override the file ----------

test('options.title and options.timeSignature override the file', () => {
  const r = parseMusicXML(fixture('technical.musicxml'), {
    title: 'Renamed',
    timeSignature: [7, 8],
    tuning: 'sawmill',
  });
  assert.equal(r.ok, true, r.error);
  assertValidTab(r.tab);
  assert.equal(r.tab.title, 'Renamed');
  assert.deepEqual(r.tab.timeSignature, [7, 8]);
  assert.equal(r.tab.tuning, 'sawmill');
});
