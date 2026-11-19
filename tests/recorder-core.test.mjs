// Tests for the pure recorder session logic, driven the way a fake port would
// drive it: messages in, assemble() out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecorderSession, frameToCtxTime, toRecordingBase } from '../src/audio/recorder-core.js';

const SR = 48000;

function chunk(frame, n, fill = 0.5) {
  return { type: 'chunk', frame, samples: new Float32Array(n).fill(fill) };
}

test('started message resolves the measured origin on the audio clock', () => {
  const s = createRecorderSession({ sampleRate: SR });
  const evt = s.handleMessage({ type: 'started', frame: 12 * SR, sampleRate: SR });
  assert.equal(evt.event, 'started');
  assert.equal(evt.ctxTime, 12);
  assert.equal(s.startedAtCtxTime, 12);
  assert.equal(frameToCtxTime(2400, SR), 0.05);
});

test('chunks assemble in frame order even when they arrive out of order', () => {
  const s = createRecorderSession({ sampleRate: SR });
  s.handleMessage({ type: 'started', frame: 100, sampleRate: SR });
  s.handleMessage(chunk(124, 24, 0.3));
  s.handleMessage(chunk(100, 24, 0.1));
  const { samples, startFrame, gaps } = s.assemble();
  assert.equal(startFrame, 100);
  assert.equal(samples.length, 48);
  assert.equal(gaps.length, 0);
  assert.ok(Math.abs(samples[0] - 0.1) < 1e-6, 'first chunk first');
  assert.ok(Math.abs(samples[24] - 0.3) < 1e-6, 'second chunk second');
});

test('a dropped chunk shows as a gap and does not shift later audio', () => {
  const s = createRecorderSession({ sampleRate: SR });
  s.handleMessage({ type: 'started', frame: 1000, sampleRate: SR });
  s.handleMessage(chunk(1000, 10, 0.1));
  // chunk at 1010..1020 dropped
  s.handleMessage(chunk(1020, 10, 0.2));
  const { samples, gaps } = s.assemble();
  assert.equal(samples.length, 30);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].atFrame, 1010);
  assert.equal(gaps[0].missingFrames, 10);
  assert.ok(Math.abs(samples[20] - 0.2) < 1e-6, 'later chunk keeps its frame position');
  assert.equal(samples[10], 0, 'gap is zero-filled');
});

test('stopped message marks the session stopped', () => {
  const s = createRecorderSession({ sampleRate: SR });
  assert.equal(s.isStopped(), false);
  s.handleMessage({ type: 'stopped' });
  assert.equal(s.isStopped(), true);
});

test('maxSamples evicts the oldest chunks but keeps recent audio', () => {
  const s = createRecorderSession({ sampleRate: SR, maxSamples: 20 });
  s.handleMessage({ type: 'started', frame: 0, sampleRate: SR });
  s.handleMessage(chunk(0, 10, 0.1));
  s.handleMessage(chunk(10, 10, 0.2));
  s.handleMessage(chunk(20, 10, 0.3));
  const { samples } = s.assemble();
  assert.ok(samples.length <= 30);
  assert.ok(Math.abs(samples[samples.length - 1] - 0.3) < 1e-6, 'newest audio retained');
});

test('toRecordingBase shifts times to the recording origin', () => {
  assert.deepEqual(toRecordingBase([1.0, 2.5], 0.5), [0.5, 2.0]);
  assert.deepEqual(toRecordingBase([], 1), []);
});
