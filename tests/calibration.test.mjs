// F7 verification: system latency (acoustic loopback) and the player's
// habitual play-along offset are separate measurements, and only the system
// figure is subtracted in scoring.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCalibration, computeSystemCalibration, computePlayerHabit,
  jitterWarning, scoringOffsetMs, calibrationKey,
} from '../src/audio/calibration.js';

const CLICKS = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5];

function withOffset(offsetMs, jitterPatternMs = []) {
  return CLICKS.map((t, i) => t + (offsetMs + (jitterPatternMs[i] ?? 0)) / 1000);
}

test('computeCalibration measures the mean offset and jitter', () => {
  const r = computeCalibration(CLICKS, withOffset(40, [0, 1, -1, 0, 1, -1, 0, 1, -1, 0, 1, -1, 0, 1, -1, 0]));
  assert.equal(r.matched, 16);
  assert.ok(Math.abs(r.offsetMs - 40) < 0.5, `offset ${r.offsetMs}`);
  assert.ok(r.jitterMs > 0 && r.jitterMs < 2, `jitter ${r.jitterMs}`);
});

test('loopback measures pure system latency (no playing involved)', () => {
  // The mic hears each click 45 ms after it was scheduled, with tiny jitter.
  const onsets = withOffset(45, [0, 0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, -0.5, 0]);
  const r = computeSystemCalibration(CLICKS, onsets);
  assert.ok(Math.abs(r.systemOffsetMs - 45) < 1, `systemOffsetMs ${r.systemOffsetMs}`);
  assert.ok(r.systemJitterMs < 2, `systemJitterMs ${r.systemJitterMs}`);
  assert.equal(r.matched, 16);
});

test('play-along habit is the residual after removing system latency', () => {
  // System latency 45 ms; the player habitually plays 15 ms late on top of it.
  const onsets = withOffset(60);
  const r = computePlayerHabit(CLICKS, onsets, 45);
  assert.ok(Math.abs(r.playerOffsetMs - 15) < 1, `playerOffsetMs ${r.playerOffsetMs}`);
  assert.ok(Math.abs(r.playAlongOffsetMs - 60) < 1, `raw play-along ${r.playAlongOffsetMs}`);
});

test('an early player habit reads negative', () => {
  // System latency 45 ms; the player habitually plays 25 ms early.
  const onsets = withOffset(20);
  const r = computePlayerHabit(CLICKS, onsets, 45);
  assert.ok(Math.abs(r.playerOffsetMs - (-25)) < 1, `playerOffsetMs ${r.playerOffsetMs}`);
});

test('scoring subtracts only the system offset (legacy records supported)', () => {
  assert.equal(scoringOffsetMs(null), 0);
  assert.equal(scoringOffsetMs({ systemOffsetMs: 45, playerOffsetMs: 15 }), 45);
  assert.equal(scoringOffsetMs({ offsetMs: 30 }), 30, 'legacy field fallback');
  assert.equal(scoringOffsetMs({ systemOffsetMs: 0, offsetMs: 999 }), 0);
});

test('jitter warning names which measurement it refers to', () => {
  assert.equal(jitterWarning(5, 10, 'the system (loopback) measurement'), null);
  const w = jitterWarning(14, 10, 'the play-along measurement');
  assert.match(w, /play-along measurement/);
  assert.match(w, /14 ms/);
});

test('calibrationKey is stable per device pair', () => {
  assert.equal(calibrationKey('mic1', 'out1'), 'cal:mic1|out1');
  assert.equal(calibrationKey(null, null), 'cal:default|default');
});
