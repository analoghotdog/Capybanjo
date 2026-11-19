// F5 verification: one continuous recording sliced into three loops must give
// the right per-loop expected times and onset counts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClickBursts } from './signal-fixtures.js';
import { detectOnsets } from '../src/audio/onset.js';
import { alignOnsets } from '../src/features/alignment.js';
import { sliceSamples, entriesInRange, toRecordingBase } from '../src/audio/recorder-core.js';

const SR = 44100;
const ORIGIN = 1.0;

test('a continuous take sliced into three loops gives per-loop onsets and expected notes', () => {
  // Three 1-second loops starting at ctx 2.0, 3.0, 4.0; each loop plays three
  // notes at +0.1, +0.3, +0.5 s. The recording runs from ctx ORIGIN onwards.
  const loops = [[2.0, 3.0], [3.0, 4.0], [4.0, 5.0]];
  const noteOffsets = [0.1, 0.3, 0.5];
  const scheduled = []; // scheduled note events, like player.cursorQueue()
  for (const [start] of loops) {
    for (const off of noteOffsets) {
      scheduled.push({ time: start + off });
    }
  }
  const clickCtxTimes = scheduled.map((e) => e.time);
  const relTimes = toRecordingBase(clickCtxTimes, ORIGIN);
  const continuous = makeClickBursts({
    sampleRate: SR,
    durationSec: relTimes[relTimes.length - 1] + 0.5,
    times: relTimes,
  });

  loops.forEach(([from, to], li) => {
    const { samples: slice, offsetSec } = sliceSamples(continuous, SR, ORIGIN, from, to);
    assert.equal(slice.length, Math.round((to - from) * SR), `loop ${li}: slice length`);

    // Per-loop expected notes: scheduled times within the loop window.
    const expected = entriesInRange(scheduled, from, to);
    assert.equal(expected.length, 3, `loop ${li}: three expected notes`);
    for (const e of expected) assert.ok(e.time >= from && e.time < to);

    // Onsets in the slice (slice time base starts at the loop boundary).
    const onsets = detectOnsets(slice, SR);
    assert.equal(onsets.length, 3, `loop ${li}: three onsets detected`);

    const expectedTimes = expected.map((e) => e.time - from);
    const { matches, missed, extra } = alignOnsets(onsets, expectedTimes);
    assert.equal(matches.length, 3, `loop ${li}: all notes matched`);
    assert.equal(missed.length, 0);
    assert.equal(extra.length, 0);

    // Offset bookkeeping: slice starts offsetSec into the recording.
    assert.ok(Math.abs(offsetSec - (from - ORIGIN)) < 1e-9);
  });
});

test('entriesInRange boundaries are inclusive-start, exclusive-end', () => {
  const entries = [{ time: 1 }, { time: 2 }, { time: 3 }];
  assert.deepEqual(entriesInRange(entries, 1, 3), [{ time: 1 }, { time: 2 }]);
  assert.deepEqual(entriesInRange(entries, 2, 2), []);
  assert.deepEqual(entriesInRange([], 0, 1), []);
});

test('sliceSamples clamps to the buffer', () => {
  const samples = new Float32Array(SR); // 1 second
  const { samples: tail } = sliceSamples(samples, SR, 0, 0.5, 2.0);
  assert.equal(tail.length, SR / 2, 'clipped at the end of the buffer');
  const { samples: none } = sliceSamples(samples, SR, 0, 2.0, 3.0);
  assert.equal(none.length, 0, 'window entirely past the buffer');
});
