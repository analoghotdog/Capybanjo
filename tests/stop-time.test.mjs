// F4 verification: the run must stop after the last scheduled event has
// actually sounded (plus a tail), not at the moment it was scheduled —
// otherwise the final click is cut off and reported as missed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClickBursts } from './signal-fixtures.js';
import { detectOnsets } from '../src/audio/onset.js';
import { scoreGrid } from '../src/features/timing-report.js';
import { toRecordingBase, stopTimeAfter, shouldStopNow } from '../src/audio/recorder-core.js';

const SR = 44100;

test('stopTimeAfter adds the tail and shouldStopNow gates on the clock', () => {
  assert.equal(stopTimeAfter(10, 0.5), 10.5);
  assert.equal(stopTimeAfter(10), 10.5);
  assert.equal(shouldStopNow(10.49, 10), false);
  assert.equal(shouldStopNow(10.5, 10), true);
});

test('a 4-bar run at 80 BPM on a perfect take reports zero missed notes', () => {
  const origin = 0.5;
  const beatDur = 60 / 80; // 0.75 s per quarter note
  const grid = Array.from({ length: 16 }, (_, i) => origin + 0.2 + i * beatDur); // 4 bars of 4/4
  const rel = toRecordingBase(grid, origin);
  const full = makeClickBursts({ sampleRate: SR, durationSec: rel[rel.length - 1] + 1, times: rel });

  // F4 rule: the recording stops tail=0.5 s after the last scheduled event.
  const stopAt = stopTimeAfter(grid[grid.length - 1]);
  const take = full.slice(0, Math.round((stopAt - origin) * SR));

  const onsets = detectOnsets(take, SR);
  const report = scoreGrid(onsets, rel);
  assert.equal(report.missed, 0, 'no grid note missed');
  assert.equal(report.extra, 0, 'no spurious onset');
  assert.ok(Math.abs(report.biasMs) <= 1, `bias ${report.biasMs.toFixed(2)} ms near zero`);
});

test('stopping when the last tick is only scheduled cuts the final click', () => {
  const origin = 0.5;
  const beatDur = 60 / 80;
  const grid = Array.from({ length: 16 }, (_, i) => origin + 0.2 + i * beatDur);
  const rel = toRecordingBase(grid, origin);
  const full = makeClickBursts({ sampleRate: SR, durationSec: rel[rel.length - 1] + 1, times: rel });

  // The old behaviour: stopRun() fired when the last tick was scheduled, up to
  // the 100 ms lookahead before it sounded.
  const stopAt = grid[grid.length - 1] - 0.06;
  const take = full.slice(0, Math.round((stopAt - origin) * SR));

  const onsets = detectOnsets(take, SR);
  const report = scoreGrid(onsets, rel);
  assert.ok(report.missed >= 1, 'the final click is cut off and reported missed');
});
