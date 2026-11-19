import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPitchYIN } from '../src/audio/pitch.js';
import { makeSine, makePlucks, centsError } from './signal-fixtures.js';

const SR = 44100;

const BANJO_RANGE_HZ = [140, 196, 220, 261.63, 329.63, 440, 587.33, 698.46];

for (const freq of BANJO_RANGE_HZ) {
  test(`sine at ${freq} Hz detected within 3 cents`, () => {
    const samples = makeSine({ sampleRate: SR, frequency: freq, durationSec: 0.25, amp: 0.7 });
    const { frequency, probability } = detectPitchYIN(samples, SR);
    assert.ok(frequency !== null, `no pitch detected for ${freq} Hz sine`);
    const err = centsError(frequency, freq);
    assert.ok(err <= 3, `${freq} Hz: detected ${frequency.toFixed(3)} Hz, error ${err.toFixed(2)} cents`);
    assert.ok(probability > 0.5, `probability should be high for a pure sine, got ${probability}`);
  });
}

test('plucked-string-like signal (decaying harmonics) at 220 Hz within 3 cents', () => {
  const samples = makePlucks({
    sampleRate: SR,
    durationSec: 0.4,
    times: [0.02],
    frequency: 220,
    harmonics: [1, 0.6, 0.4, 0.25, 0.15],
    decaySec: 0.5,
    amp: 0.8,
  });
  const { frequency } = detectPitchYIN(samples, SR);
  assert.ok(frequency !== null, 'no pitch detected for plucked signal');
  const err = centsError(frequency, 220);
  assert.ok(err <= 3, `220 Hz pluck: detected ${frequency.toFixed(3)} Hz, error ${err.toFixed(2)} cents`);
});

test('plucked-string-like signal at 329.63 Hz within 3 cents', () => {
  const samples = makePlucks({
    sampleRate: SR,
    durationSec: 0.4,
    times: [0.02],
    frequency: 329.63,
    harmonics: [1, 0.5, 0.33, 0.2],
    decaySec: 0.4,
    ringHarmonics: [0.1],
    ringDecaySec: 1.0,
    amp: 0.8,
  });
  const { frequency } = detectPitchYIN(samples, SR);
  assert.ok(frequency !== null, 'no pitch detected for plucked signal');
  const err = centsError(frequency, 329.63);
  assert.ok(err <= 3, `329.63 Hz pluck: detected ${frequency.toFixed(3)} Hz, error ${err.toFixed(2)} cents`);
});

test('silence returns null frequency', () => {
  const { frequency, probability } = detectPitchYIN(new Float32Array(SR / 2), SR);
  assert.equal(frequency, null);
  assert.equal(probability, 0);
});

test('too-short input returns null frequency', () => {
  const { frequency } = detectPitchYIN(new Float32Array(100), SR);
  assert.equal(frequency, null);
});
