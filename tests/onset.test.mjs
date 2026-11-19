import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectOnsets } from '../src/audio/onset.js';
import {
  makeClickBursts,
  makePlucks,
} from './signal-fixtures.js';

const SR = 44100;
const TOLERANCE = 0.005; // 5 ms

/** Assert every expected time has a detected onset within `tol` seconds. */
function assertAllDetected(expected, detected, tol = TOLERANCE) {
  for (const t of expected) {
    const hit = detected.some((d) => Math.abs(d - t) <= tol);
    assert.ok(hit, `onset at ${t.toFixed(4)}s not detected within ${tol * 1000}ms (got ${detected.map((d) => d.toFixed(4)).join(', ')})`);
  }
}

test('click bursts at known times are detected within 5 ms', () => {
  const times = [0.25, 0.6, 0.95, 1.3, 1.65];
  const samples = makeClickBursts({ sampleRate: SR, durationSec: 2.0, times, clickMs: 2, amp: 0.8 });
  const detected = detectOnsets(samples, SR);
  assertAllDetected(times, detected);
  assert.ok(detected.length <= times.length + 1, `expected at most ${times.length + 1} onsets, got ${detected.length}`);
  for (const d of detected) {
    assert.ok(times.some((t) => Math.abs(d - t) <= 0.02), `spurious onset at ${d.toFixed(4)}s`);
  }
});

test('decaying plucks (exponential harmonic tone) are detected within 5 ms', () => {
  const times = [0.2, 0.55, 0.9, 1.25, 1.6];
  const samples = makePlucks({
    sampleRate: SR,
    durationSec: 2.0,
    times,
    frequency: 196,
    harmonics: [1, 0.55, 0.35, 0.2],
    decaySec: 0.12,
    amp: 0.8,
  });
  const detected = detectOnsets(samples, SR);
  assertAllDetected(times, detected);
  assert.ok(detected.length <= times.length + 1, `expected at most ${times.length + 1} onsets, got ${detected.length}`);
});

test('plucks with ringing/sustained harmonics are detected within 5 ms', () => {
  const times = [0.25, 0.7, 1.15];
  const samples = makePlucks({
    sampleRate: SR,
    durationSec: 1.6,
    times,
    frequency: 293.66,
    harmonics: [1, 0.5, 0.3],
    decaySec: 0.15,
    ringHarmonics: [0.35, 0.25], // slow-decaying ringing partials
    ringDecaySec: 1.2,
    amp: 0.8,
  });
  const detected = detectOnsets(samples, SR);
  assertAllDetected(times, detected);
  assert.ok(detected.length <= times.length + 1, `expected at most ${times.length + 1} onsets, got ${detected.length}`);
});

test('minIntervalMs suppresses double-triggers from closely spaced attacks', () => {
  const times = [0.3, 0.325, 0.8]; // pair only 25 ms apart
  const samples = makeClickBursts({ sampleRate: SR, durationSec: 1.2, times, clickMs: 2, amp: 0.8 });

  const strict = detectOnsets(samples, SR, { minIntervalMs: 60 });
  assert.ok(strict.length <= 2, `expected at most 2 onsets with minIntervalMs=60, got ${strict.length}`);
  const nearFirst = strict.filter((d) => Math.abs(d - 0.3) <= 0.025).length;
  assert.equal(nearFirst, 1, 'the 25 ms pair must not double-trigger with minIntervalMs=60');
  const hasLone = strict.some((d) => Math.abs(d - 0.8) <= TOLERANCE);
  assert.ok(hasLone, 'the isolated onset at 0.8 s must still be detected');

  const loose = detectOnsets(samples, SR, { minIntervalMs: 10 });
  assert.ok(loose.length >= 3, `expected both closely spaced onsets with minIntervalMs=10, got ${loose.length}`);
  assertAllDetected(times, loose);
});

test('sensitivity changes the onset count in the expected direction', () => {
  // Three loud plucks and two quiet ones (each quiet one shortly after a loud
  // one): the higher threshold multiplier must drop the quiet onsets while
  // still catching the loud ones.
  const times = [0.2, 0.28, 0.6, 0.68, 1.0];
  const amps = [0.9, 0.45, 0.9, 0.45, 0.85];
  const samples = makePlucks({
    sampleRate: SR,
    durationSec: 1.4,
    times,
    frequency: 246.94,
    harmonics: [1, 0.5, 0.3],
    decaySec: 0.12,
    amp: amps,
  });

  const low = detectOnsets(samples, SR, { sensitivity: 1.5 });
  const high = detectOnsets(samples, SR, { sensitivity: 3.0 });

  assertAllDetected(times, low); // all five plucks at low sensitivity
  assert.ok(low.length >= 5, `sensitivity 1.5 should detect at least the 5 plucks, got ${low.length}`);
  assert.ok(high.length <= 3, `sensitivity 3.0 should detect at most the 3 loud plucks, got ${high.length}`);
  assert.ok(high.length < low.length, `higher sensitivity must give fewer onsets (${high.length} !< ${low.length})`);
  // The loud onsets must survive at high sensitivity.
  assertAllDetected([0.2, 0.6, 1.0], high);
});

test('detectOnsets returns an ascending array and handles short input', () => {
  const times = [0.15, 0.45, 0.75];
  const samples = makeClickBursts({ sampleRate: SR, durationSec: 1.0, times, clickMs: 2, amp: 0.8 });
  const detected = detectOnsets(samples, SR);
  for (let i = 1; i < detected.length; i++) {
    assert.ok(detected[i] > detected[i - 1], 'onset times must be strictly ascending');
  }
  assert.deepEqual(detectOnsets(new Float32Array(512), SR), []);
  assert.deepEqual(detectOnsets(new Float32Array(2048), SR), []);
});
