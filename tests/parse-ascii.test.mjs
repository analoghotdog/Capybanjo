import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseAsciiTab } from '../src/tab/parse-ascii.js';
import { validateTab } from '../src/tab/model.js';

function assertValidTab(tab) {
  const r = validateTab(tab);
  assert.equal(r.ok, true, r.errors.join('; '));
}

// ---------- 1. simple 5-line block ----------

test('simple 5-line block: strings, frets and even columns', () => {
  const text = [
    'D|--0--2--|',
    'B|--0--1--|',
    'G|--0--0--|',
    'D|--0--0--|',
    'g|-------|',
  ].join('\n');

  const r = parseAsciiTab(text);
  assert.equal(r.ok, true, r.error);
  assertValidTab(r.tab);
  assert.deepEqual(r.warnings, []);

  // "g" is the short 5th string; the four labelled pitch lines fill 1..4.
  // Two digit columns (char positions 2 and 5) -> beats 0 and 0.5 (eighths).
  assert.deepEqual(r.tab.notes, [
    { string: 1, fret: 0, startBeat: 0, durationBeats: 0.5, finger: null },
    { string: 2, fret: 0, startBeat: 0, durationBeats: 0.5, finger: null },
    { string: 3, fret: 0, startBeat: 0, durationBeats: 0.5, finger: null },
    { string: 4, fret: 0, startBeat: 0, durationBeats: 0.5, finger: null },
    { string: 1, fret: 2, startBeat: 0.5, durationBeats: 0.5, finger: null },
    { string: 2, fret: 1, startBeat: 0.5, durationBeats: 0.5, finger: null },
    { string: 3, fret: 0, startBeat: 0.5, durationBeats: 0.5, finger: null },
    { string: 4, fret: 0, startBeat: 0.5, durationBeats: 0.5, finger: null },
  ]);

  assert.equal(r.tab.title, 'Imported ASCII tab');
  assert.equal(r.tab.source, 'ASCII import');
  assert.equal(r.tab.tuning, 'openG');
  assert.deepEqual(r.tab.timeSignature, [4, 4]);
  assert.equal(r.tab.rhythmUnknown, true);
});

// ---------- 2. multi-digit frets ----------

test('multi-digit frets are read as one fret, not split digits', () => {
  const text = [
    'D|--10--12--|',
    'B|--10--12--|',
    'G|--10--12--|',
    'D|--10--12--|',
    'g|----------|',
  ].join('\n');

  const r = parseAsciiTab(text);
  assert.equal(r.ok, true, r.error);
  assertValidTab(r.tab);
  assert.equal(r.tab.notes.length, 8);
  for (const n of r.tab.notes.filter((n) => n.startBeat === 0)) {
    assert.equal(n.fret, 10);
    assert.equal(n.startBeat, 0);
    assert.equal(n.durationBeats, 0.5);
  }
  for (const n of r.tab.notes.filter((n) => n.startBeat === 0.5)) {
    assert.equal(n.fret, 12);
  }
  assert.deepEqual(
    r.tab.notes.map((n) => [n.string, n.fret, n.startBeat]),
    [
      [1, 10, 0], [2, 10, 0], [3, 10, 0], [4, 10, 0],
      [1, 12, 0.5], [2, 12, 0.5], [3, 12, 0.5], [4, 12, 0.5],
    ],
  );
});

// ---------- 3. bar lines ----------

test('bar lines are visual only and never create note columns', () => {
  const text = [
    'D|--0--|--2--|',
    'B|--1--|--3--|',
    'G|--0--|--0--|',
    'D|--0--|--0--|',
    'g|-----|-----|',
  ].join('\n');

  const r = parseAsciiTab(text);
  assert.equal(r.ok, true, r.error);
  assertValidTab(r.tab);
  // Still exactly two note columns: the bar line adds no beat.
  assert.equal(r.tab.notes.length, 8);
  assert.deepEqual([...new Set(r.tab.notes.map((n) => n.startBeat))], [0, 0.5]);
  assert.deepEqual(
    r.tab.notes.map((n) => [n.string, n.fret, n.startBeat]),
    [
      [1, 0, 0], [2, 1, 0], [3, 0, 0], [4, 0, 0],
      [1, 2, 0.5], [2, 3, 0.5], [3, 0, 0.5], [4, 0, 0.5],
    ],
  );
});

// ---------- 4. two stacked systems ----------

test('two stacked systems continue as one piece (columns concatenated)', () => {
  const sys1 = ['D|--0--|', 'B|--1--|', 'G|--0--|', 'D|--2--|', 'g|-----|'];
  const sys2 = ['D|--3--|', 'B|--2--|', 'G|--0--|', 'D|--0--|', 'g|-----|'];

  const expected = [
    { string: 1, fret: 0, startBeat: 0, durationBeats: 0.5, finger: null },
    { string: 2, fret: 1, startBeat: 0, durationBeats: 0.5, finger: null },
    { string: 3, fret: 0, startBeat: 0, durationBeats: 0.5, finger: null },
    { string: 4, fret: 2, startBeat: 0, durationBeats: 0.5, finger: null },
    { string: 1, fret: 3, startBeat: 0.5, durationBeats: 0.5, finger: null },
    { string: 2, fret: 2, startBeat: 0.5, durationBeats: 0.5, finger: null },
    { string: 3, fret: 0, startBeat: 0.5, durationBeats: 0.5, finger: null },
    { string: 4, fret: 0, startBeat: 0.5, durationBeats: 0.5, finger: null },
  ];

  for (const joined of [[...sys1, '', ...sys2].join('\n'), [...sys1, ...sys2].join('\n')]) {
    const r = parseAsciiTab(joined);
    assert.equal(r.ok, true, r.error);
    assertValidTab(r.tab);
    assert.deepEqual(r.tab.notes, expected);
  }
});

// ---------- 5. 6-line block ----------

test('6-line block imports top five lines and warns about the lowest', () => {
  const text = [
    'e|--0--|',
    'B|--1--|',
    'G|--2--|',
    'D|--3--|',
    'A|--4--|',
    'E|--5--|',
  ].join('\n');

  const r = parseAsciiTab(text);
  assert.equal(r.ok, true, r.error);
  assertValidTab(r.tab);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /6-line/);
  assert.match(r.warnings[0], /lowest/);
  assert.deepEqual(
    r.tab.notes.map((n) => [n.string, n.fret, n.startBeat]),
    [[1, 0, 0], [2, 1, 0], [3, 2, 0], [4, 3, 0], [5, 4, 0]],
  );
  assert.ok(r.tab.notes.every((n) => n.fret !== 5), 'lowest line must be ignored');
});

// ---------- 6. malformed input ----------

test('malformed input returns ok:false with a readable error', () => {
  for (const bad of [
    'This is just prose.\nNo tab here.',
    '',
    'D|--0--|\nB|--1--|\nG|--0--|', // fragment: only 3 string lines
    'Intro\n|--0--|\n|--1--|', // lines without string labels
  ]) {
    const r = parseAsciiTab(bad);
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, 'string');
    assert.ok(r.error.length > 0);
    assert.match(r.error, /tab/i);
  }
  assert.equal(parseAsciiTab(123).ok, false);
  assert.equal(parseAsciiTab('D|--0--|\nB|--1--|\nG|--0--|\nD|--2--|\ng|--3--|', { subdivision: 0 }).ok, false);
});

// ---------- 7. stringMap override ----------

test('options.stringMap overrides the default string assignment', () => {
  const text = [
    'A|--0--|',
    'B|--1--|',
    'G|--2--|',
    'D|--3--|',
    'g|--4--|',
  ].join('\n');

  const r = parseAsciiTab(text, { stringMap: { A: 5, g: 1 } });
  assert.equal(r.ok, true, r.error);
  assertValidTab(r.tab);
  assert.deepEqual(
    r.tab.notes.map((n) => [n.string, n.fret]),
    [[1, 4], [2, 1], [3, 2], [4, 3], [5, 0]],
  );
});

// ---------- 8. "g"/"5" line is the short 5th string wherever it sits ----------

test('a "g" line is pinned to string 5 even at the top of the block', () => {
  const text = [
    'g|--0--|',
    'D|--2--|',
    'B|--3--|',
    'G|--4--|',
    'D|--5--|',
  ].join('\n');

  const r = parseAsciiTab(text);
  assert.equal(r.ok, true, r.error);
  assertValidTab(r.tab);
  assert.deepEqual(
    r.tab.notes.map((n) => [n.string, n.fret]),
    [[1, 2], [2, 3], [3, 4], [4, 5], [5, 0]],
  );

  // Numeric label "5" behaves the same way.
  const r2 = parseAsciiTab(
    ['5|--0--|', '1|--1--|', '2|--2--|', '3|--3--|', '4|--4--|'].join('\n'),
  );
  assert.equal(r2.ok, true, r2.error);
  assert.deepEqual(
    r2.tab.notes.map((n) => [n.string, n.fret]),
    [[1, 1], [2, 2], [3, 3], [4, 4], [5, 0]],
  );
});

// ---------- 9. options: subdivision, title, tuning, timeSignature ----------

test('options control subdivision, title, tuning and time signature', () => {
  const text = [
    'D|--0--2--|',
    'B|--0--1--|',
    'G|--0--0--|',
    'D|--0--0--|',
    'g|-------|',
  ].join('\n');

  const r = parseAsciiTab(text, {
    subdivision: 4, // quarters => columns are quarter notes
    title: 'My Tune',
    tuning: 'doubleC',
    timeSignature: [3, 4],
  });
  assert.equal(r.ok, true, r.error);
  assertValidTab(r.tab);
  assert.equal(r.tab.title, 'My Tune');
  assert.equal(r.tab.tuning, 'doubleC');
  assert.deepEqual(r.tab.timeSignature, [3, 4]);
  assert.deepEqual([...new Set(r.tab.notes.map((n) => n.startBeat))], [0, 0.25]);
  assert.ok(r.tab.notes.every((n) => n.durationBeats === 0.25));
});
