import test from 'node:test';
import assert from 'node:assert/strict';
import { alignOnsets } from '../src/features/alignment.js';

const approx = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${expected}, got ${actual}`);

test('perfect match: every detection pairs with its expected note', () => {
  const { matches, missed, extra } = alignOnsets([0.005, 0.49, 1.02], [0, 0.5, 1]);
  assert.equal(matches.length, 3);
  assert.deepEqual(missed, []);
  assert.deepEqual(extra, []);
  assert.deepEqual(matches.map((m) => m.expectedIndex), [0, 1, 2]);
  assert.deepEqual(matches.map((m) => m.detectedIndex), [0, 1, 2]);
  approx(matches[0].deviationMs, 5);
  approx(matches[1].deviationMs, -10);
  approx(matches[2].deviationMs, 20);
});

test('one missed note: expected index without detection is reported', () => {
  const { matches, missed, extra } = alignOnsets([0, 1], [0, 0.5, 1]);
  assert.deepEqual(matches.map((m) => m.expectedIndex), [0, 2]);
  assert.deepEqual(matches.map((m) => m.detectedIndex), [0, 1]);
  assert.deepEqual(missed, [1]);
  assert.deepEqual(extra, []);
});

test('one extra note: detection without expected note is reported', () => {
  const { matches, missed, extra } = alignOnsets([0, 0.5, 1], [0, 1]);
  assert.deepEqual(matches.map((m) => m.expectedIndex), [0, 1]);
  assert.deepEqual(matches.map((m) => m.detectedIndex), [0, 2]);
  assert.deepEqual(missed, []);
  assert.deepEqual(extra, [1]);
});

test('two close detections each match the nearest expected note', () => {
  const { matches, missed, extra } = alignOnsets([0.02, 0.18], [0, 0.2]);
  assert.deepEqual(matches.map((m) => m.expectedIndex), [0, 1]);
  assert.deepEqual(matches.map((m) => m.detectedIndex), [0, 1]);
  approx(matches[0].deviationMs, 20);
  approx(matches[1].deviationMs, -20);
  assert.deepEqual(missed, []);
  assert.deepEqual(extra, []);
});

test('near-swapped detections resolve to the nearest non-crossing pairing', () => {
  // e0=0, e1=50ms; d0=40ms, d1=60ms. Crossing (e0-d1, e1-d0) costs 70ms,
  // in-order pairing costs 50ms and must win. The tolerance is pinned
  // explicitly: this test is about crossing resolution, and the tempo-aware
  // default would reject the 40ms deviation at 50ms spacing (tolerance policy
  // is covered in tests/tolerance.test.mjs).
  const { matches, missed, extra } = alignOnsets([0.04, 0.06], [0, 0.05], { toleranceMs: 250 });
  assert.deepEqual(matches.map((m) => m.expectedIndex), [0, 1]);
  assert.deepEqual(matches.map((m) => m.detectedIndex), [0, 1]);
  approx(matches[0].deviationMs, 40);
  approx(matches[1].deviationMs, 10);
  assert.deepEqual(missed, []);
  assert.deepEqual(extra, []);
});

test('uniformly shifted detections still match with the shift as deviation', () => {
  const { matches, missed, extra } = alignOnsets([0.08, 0.58, 1.08], [0, 0.5, 1]);
  assert.equal(matches.length, 3);
  assert.deepEqual(missed, []);
  assert.deepEqual(extra, []);
  for (const m of matches) approx(m.deviationMs, 80);
});

test('detections outside tolerance become missed/extra pairs', () => {
  const { matches, missed, extra } = alignOnsets([0.4], [0], { toleranceMs: 250 });
  assert.deepEqual(matches, []);
  assert.deepEqual(missed, [0]);
  assert.deepEqual(extra, [0]);
});

test('tolerance boundary: exactly toleranceMs still matches', () => {
  const { matches, missed, extra } = alignOnsets([0.25], [0], { toleranceMs: 250 });
  assert.equal(matches.length, 1);
  approx(matches[0].deviationMs, 250);
  assert.deepEqual(missed, []);
  assert.deepEqual(extra, []);
});

test('empty inputs', () => {
  assert.deepEqual(alignOnsets([], []), { matches: [], missed: [], extra: [] });

  const onlyDetected = alignOnsets([1, 2], []);
  assert.deepEqual(onlyDetected.matches, []);
  assert.deepEqual(onlyDetected.missed, []);
  assert.deepEqual(onlyDetected.extra, [0, 1]);

  const onlyExpected = alignOnsets([], [1, 2]);
  assert.deepEqual(onlyExpected.matches, []);
  assert.deepEqual(onlyExpected.missed, [0, 1]);
  assert.deepEqual(onlyExpected.extra, []);
});

test('mixed case: missed, extra and matches together', () => {
  // expected: 0, 0.5, 1.0, 1.5 ; detected: 0.01, 1.52, 2.0 (stray, out of
  // tolerance of every expected note); 0.5 and 1.0 are missed.
  const { matches, missed, extra } = alignOnsets([0.01, 1.52, 2.0], [0, 0.5, 1, 1.5]);
  assert.deepEqual(matches.map((m) => m.expectedIndex), [0, 3]);
  assert.deepEqual(matches.map((m) => m.detectedIndex), [0, 1]);
  assert.deepEqual(missed, [1, 2]);
  assert.deepEqual(extra, [2]);
});
