// F3 verification: a synthetic click track pushed through the same origin
// conversion and scoring code the Record view uses. The injected offset must
// be recovered within 1 ms, which only works with the measured recording
// origin (the old fixed ctx.currentTime + constant guesses shift the report).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClickBursts } from './signal-fixtures.js';
import { detectOnsets } from '../src/audio/onset.js';
import { scoreGrid } from '../src/features/timing-report.js';
import { toRecordingBase, frameToCtxTime } from '../src/audio/recorder-core.js';

const SR = 44100;

/** Build a recording that begins at `originSec` on the audio clock and has a
 * click at each grid time, played `offsetMs` early/late. */
function syntheticTake({ originSec, clickCtxTimes, offsetMs }) {
  const onsetCtx = clickCtxTimes.map((t) => t + offsetMs / 1000);
  const relTimes = onsetCtx.map((t) => t - originSec);
  const durationSec = Math.max(...relTimes) + 0.3;
  return makeClickBursts({ sampleRate: SR, durationSec, times: relTimes });
}

test('scoring recovers an injected offset within 1 ms using the measured origin', () => {
  const origin = 0.7;
  const clicks = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5];
  for (const offsetMs of [12, -8, 0]) {
    const samples = syntheticTake({ originSec: origin, clickCtxTimes: clicks, offsetMs });
    const onsets = detectOnsets(samples, SR);
    const gridRel = toRecordingBase(clickTimesArray(clicks), origin);
    const report = scoreGrid(onsets, gridRel);
    assert.equal(report.missed, 0, `offset ${offsetMs}: all grid notes detected`);
    assert.equal(report.extra, 0, `offset ${offsetMs}: no spurious onsets`);
    assert.ok(
      Math.abs(report.biasMs - offsetMs) <= 1,
      `bias ${report.biasMs.toFixed(2)} ms should be within 1 ms of injected ${offsetMs} ms`
    );
  }
});

test('an origin error (the old fixed-constant behaviour) shows up 1:1 in the bias', () => {
  const origin = 0.7;
  const guessedOrigin = origin + 0.05; // e.g. assumed ctx.currentTime + 0.1
  const clicks = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5];
  const samples = syntheticTake({ originSec: origin, clickCtxTimes: clicks, offsetMs: 6 });
  const onsets = detectOnsets(samples, SR);
  const gridRel = toRecordingBase(clicks, guessedOrigin);
  const report = scoreGrid(onsets, gridRel);
  // onsets are relative to the true origin; the grid is shifted by +50 ms,
  // so the measured bias is 6 + 50 = 56 ms instead of 6 ms.
  assert.ok(
    Math.abs(report.biasMs - (6 + 50)) <= 1,
    `guessed origin skews the bias: got ${report.biasMs.toFixed(2)} ms`
  );
});

test('frame times convert to the audio clock', () => {
  assert.equal(frameToCtxTime(24000, SR), 24000 / SR);
});

function clickTimesArray(clicks) {
  return clicks.slice();
}
