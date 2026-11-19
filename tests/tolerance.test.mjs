// F6 verification: the matching tolerance must follow the tempo. A fixed
// 250 ms window is wider than the note spacing at higher tempos, so a late
// onset could be matched to the wrong (next) note.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignOnsets, toleranceForExpected } from '../src/features/alignment.js';
import { scoreGrid } from '../src/features/timing-report.js';

test('toleranceForExpected follows the smallest gap between expected times', () => {
  // 160 BPM eighth notes: 0.1875 s spacing -> 0.45 x 187.5 = 84.375 ms
  assert.ok(Math.abs(toleranceForExpected([0, 0.1875, 0.375]) - 84.375) < 1e-9);
  // Wide spacing is capped at 250 ms
  assert.equal(toleranceForExpected([0, 1, 2]), 250);
  // Single point or empty: no spacing information -> 250
  assert.equal(toleranceForExpected([0]), 250);
  assert.equal(toleranceForExpected([]), 250);
  // Uneven gaps use the smallest one
  assert.ok(Math.abs(toleranceForExpected([0, 0.1, 0.6]) - 45) < 1e-9);
  // Unsorted input is handled
  assert.ok(Math.abs(toleranceForExpected([0.375, 0, 0.1875]) - 84.375) < 1e-9);
});

test('at 160 BPM eighth notes, an onset 200 ms late is missed+extra, not matched to the next note', () => {
  // Eighths at 160 BPM quarter: spacing 0.1875 s. The player misses note 1
  // and hits it 200 ms late (0.2); note 2 is played on time (0.1875).
  const expected = [0, 0.1875];
  const detected = [0.1875, 0.2];
  const { matches, missed, extra } = alignOnsets(detected, expected);

  // The late onset must NOT be matched to the next note (index 1).
  for (const m of matches) {
    assert.notEqual(m.detectedIndex, 1, 'the 200 ms late onset must not match the next note');
  }
  assert.deepEqual(missed, [0], 'the missed note is reported missed');
  assert.deepEqual(extra, [1], 'the late onset is reported extra');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].expectedIndex, 1);
  assert.equal(matches[0].detectedIndex, 0);
});

test('a late onset outside the tempo-aware window is not pulled to a distant note', () => {
  // Spacing 0.375 s -> tolerance 168.75 ms. A 200 ms late onset matches
  // neither its own note (200 > 168.75) nor the next (175 > 168.75).
  const expected = [0, 0.375];
  const detected = [0.2];
  const { matches, missed, extra } = alignOnsets(detected, expected);
  assert.equal(matches.length, 0);
  assert.deepEqual(missed, [0, 1]);
  assert.deepEqual(extra, [0]);
  // The old fixed 250 ms tolerance would have matched it to note 0 (200 <= 250).
  const legacy = alignOnsets(detected, expected, { toleranceMs: 250 });
  assert.equal(legacy.matches.length, 1, 'documenting the old wrong match');
});

test('scoreGrid uses the tempo-aware default tolerance too', () => {
  const grid = [0, 0.1875, 0.375, 0.5625];
  // An onset 100 ms late at the fourth note: 100 > 84.375 -> unmatched now,
  // matched under the old 250 ms window.
  const onsets = [0, 0.1875, 0.375, 0.6625];
  const report = scoreGrid(onsets, grid);
  assert.equal(report.missed, 1);
  assert.equal(report.extra, 1);
  const legacy = scoreGrid(onsets, grid, { toleranceMs: 250 });
  assert.equal(legacy.missed, 0, 'the old window matched it to the wrong note');
});
