import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreGrid, rollEvenness, summarizeTiming } from '../src/features/timing-report.js';

const close = (actual, expected, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${expected}, got ${actual}`);

// ---------------------------------------------------------------- scoreGrid

test('scoreGrid: constant offset plus small noise', () => {
  // grid every 500ms; onsets run 20, 20, -20, 20 ms late
  const grid = [0, 0.5, 1.0, 1.5];
  const onsets = [0.02, 0.52, 0.98, 1.52];
  const r = scoreGrid(onsets, grid);

  assert.deepEqual(r.notes.map((n) => n.gridIndex), [0, 1, 2, 3]);
  assert.deepEqual(r.notes.map((n) => n.onsetIndex), [0, 1, 2, 3]);
  assert.deepEqual(r.deviationsMs.map((d) => Math.round(d)), [20, 20, -20, 20]);
  const expectedDevs = [20, 20, -20, 20];
  r.notes.forEach((n, i) => close(n.deviationMs, expectedDevs[i]));
  close(r.biasMs, 10); // mean of 20, 20, -20, 20
  // sample std (n-1): sqrt((10^2 + 10^2 + (-30)^2 + 10^2) / 3) = sqrt(1200/3)
  close(r.stdMs, Math.sqrt(1200 / 3));
  assert.equal(r.missed, 0);
  assert.equal(r.extra, 0);
});

test('scoreGrid: offsetMs cancels a known calibration offset', () => {
  const grid = [0, 1];
  const onsets = [0.105, 1.095]; // played ~100ms late overall, +-5ms noise
  const r = scoreGrid(onsets, grid, { offsetMs: 100 });
  close(r.deviationsMs[0], 5);
  close(r.deviationsMs[1], -5);
  close(r.biasMs, 0);
  close(r.stdMs, Math.sqrt(50)); // sqrt((25+25)/1)
});

test('scoreGrid: missed and extra notes are counted, matched one-to-one', () => {
  const grid = [0, 1, 2];
  const onsets = [0, 2];
  const r = scoreGrid(onsets, grid);
  assert.deepEqual(r.notes.map((n) => n.gridIndex), [0, 1, 2]);
  assert.deepEqual(r.notes.map((n) => n.onsetIndex), [0, null, 1]);
  assert.equal(r.notes[1].deviationMs, null);
  assert.equal(r.deviationsMs.length, 2);
  close(r.deviationsMs[0], 0);
  close(r.deviationsMs[1], 0);
  assert.equal(r.missed, 1);
  assert.equal(r.extra, 0);

  const r2 = scoreGrid([0, 0.4, 1], [0, 1]); // 0.4 is a stray
  assert.equal(r2.missed, 0);
  assert.equal(r2.extra, 1);
  assert.equal(r2.deviationsMs.length, 2);
  close(r2.deviationsMs[0], 0);
  close(r2.deviationsMs[1], 0);
});

test('scoreGrid: out-of-tolerance onsets do not match', () => {
  const r = scoreGrid([0.4], [0], { toleranceMs: 250 });
  assert.equal(r.missed, 1);
  assert.equal(r.extra, 1);
  assert.equal(r.deviationsMs.length, 0);
  assert.equal(r.biasMs, null);
  assert.equal(r.stdMs, null);
});

test('scoreGrid: a single match has a bias but no std (n-1 undefined)', () => {
  const r = scoreGrid([0.03], [0]);
  assert.equal(r.deviationsMs.length, 1);
  close(r.biasMs, 30);
  assert.equal(r.stdMs, null);
});

test('scoreGrid: empty inputs', () => {
  const r = scoreGrid([], []);
  assert.deepEqual(r.notes, []);
  assert.equal(r.deviationsMs.length, 0);
  assert.equal(r.biasMs, null);
  assert.equal(r.stdMs, null);
  assert.equal(r.missed, 0);
  assert.equal(r.extra, 0);
});

// ------------------------------------------------------------- rollEvenness

test('rollEvenness: per-finger stds and IOI spread from hand-built data', () => {
  // 4 notes: T, I, M, T. Expected times 0, 0.25, 0.5, 0.75 s.
  // deviations: +10, -10, +10, -30 ms -> onsets expected + deviation.
  const tab = {
    notes: [
      { finger: 'T' },
      { finger: 'I' },
      { finger: 'M' },
      { finger: 'T' },
      { finger: null },
    ],
  };
  const matches = [
    { expectedIndex: 0, detectedIndex: 0, deviationMs: 10 },
    { expectedIndex: 1, detectedIndex: 1, deviationMs: -10 },
    { expectedIndex: 2, detectedIndex: 2, deviationMs: 10 },
    { expectedIndex: 3, detectedIndex: 3, deviationMs: -30 },
  ];
  const onsetTimes = [0.01, 0.24, 0.51, 0.72];

  const r = rollEvenness(tab, matches, onsetTimes);

  // thumb deviations [10, -30]: mean -10, sample std sqrt((400+400)/1)
  close(r.thumbStdMs, Math.sqrt(800));
  // finger deviations [-10, 10]: sample std sqrt((100+100)/1)
  close(r.fingerStdMs, Math.sqrt(200));

  // IOI diffs: detected IOIs 0.23/0.27/0.21 vs expected 0.25 each
  // -> diffs -20, +20, -40 ms; sample std sqrt(((20/3)^2*... ) ) = sqrt(2800/3)
  close(r.ioiSpreadMs, Math.sqrt(2800 / 3));
});

test('rollEvenness: nulls when not computable', () => {
  const tab = { notes: [{ finger: 'T' }, { finger: 'I' }] };
  const matches = [
    { expectedIndex: 0, detectedIndex: 0, deviationMs: 5 },
    { expectedIndex: 1, detectedIndex: 1, deviationMs: -5 },
  ];
  const r = rollEvenness(tab, matches, [0.005, 0.995]);
  assert.equal(r.thumbStdMs, null, 'single thumb note: sample std undefined');
  assert.equal(r.fingerStdMs, null, 'single finger note: sample std undefined');
  assert.equal(r.ioiSpreadMs, null, 'only one consecutive pair: sample std undefined');

  const empty = rollEvenness({ notes: [] }, [], []);
  assert.deepEqual(empty, { thumbStdMs: null, fingerStdMs: null, ioiSpreadMs: null });
});

test('rollEvenness: notes with finger null are excluded from both groups', () => {
  const tab = { notes: [{ finger: 'T' }, { finger: null }, { finger: 'T' }] };
  const matches = [
    { expectedIndex: 0, detectedIndex: 0, deviationMs: 0 },
    { expectedIndex: 1, detectedIndex: 1, deviationMs: 500 },
    { expectedIndex: 2, detectedIndex: 2, deviationMs: 10 },
  ];
  const r = rollEvenness(tab, matches, [0, 0.55, 1.01]);
  // thumb deviations [0, 10] -> sqrt(50)
  close(r.thumbStdMs, Math.sqrt(50));
  assert.equal(r.fingerStdMs, null);
});

// ----------------------------------------------------------- summarizeTiming

test('summarizeTiming: rushing', () => {
  const { text, flags } = summarizeTiming({ biasMs: -35, stdMs: 25 });
  assert.deepEqual(flags, ['rushing']);
  assert.equal(text, 'You are rushing on average by about 35 ms.');
});

test('summarizeTiming: dragging rounds to whole ms', () => {
  const { text, flags } = summarizeTiming({ biasMs: 42.4, stdMs: 25 });
  assert.deepEqual(flags, ['dragging']);
  assert.equal(text, 'You are dragging on average by about 42 ms.');
});

test('summarizeTiming: rushing combined with uneven thumb', () => {
  const { text, flags } = summarizeTiming({
    biasMs: -25,
    stdMs: 12,
    thumbStdMs: 30,
    fingerStdMs: 15,
  });
  assert.deepEqual(flags, ['rushing', 'uneven-thumb']);
  assert.equal(
    text,
    'You are rushing on average by about 25 ms. Your thumb notes are less even than your index and middle notes.'
  );
});

test('summarizeTiming: dragging combined with uneven thumb', () => {
  const { text, flags } = summarizeTiming({
    biasMs: 25,
    stdMs: 30,
    thumbStdMs: 40,
    fingerStdMs: 10,
  });
  assert.deepEqual(flags, ['dragging', 'uneven-thumb']);
  assert.equal(
    text,
    'You are dragging on average by about 25 ms. Your thumb notes are less even than your index and middle notes.'
  );
});

test('summarizeTiming: steady', () => {
  const { text, flags } = summarizeTiming({ biasMs: 5, stdMs: 10 });
  assert.deepEqual(flags, ['steady']);
  assert.equal(text, 'Your timing is steady. Keep it up.');
});

test('summarizeTiming: nothing qualifies -> fallback text, no flags', () => {
  const { text, flags } = summarizeTiming({ biasMs: 15, stdMs: 30 });
  assert.deepEqual(flags, []);
  assert.equal(text, 'Timing is fairly steady but not yet within the clean threshold.');
});

test('summarizeTiming: uneven thumb alone suppresses steady', () => {
  const { text, flags } = summarizeTiming({
    biasMs: 0,
    stdMs: 10,
    thumbStdMs: 40,
    fingerStdMs: 10,
  });
  assert.deepEqual(flags, ['uneven-thumb']);
  assert.equal(text, 'Your thumb notes are less even than your index and middle notes.');
});

test('summarizeTiming: even thumb does not flag and steady still applies', () => {
  const { flags } = summarizeTiming({ biasMs: 0, stdMs: 10, thumbStdMs: 20, fingerStdMs: 12 });
  assert.deepEqual(flags, ['steady']);
});

test('summarizeTiming: threshold edge values', () => {
  assert.deepEqual(summarizeTiming({ biasMs: -20, stdMs: 10 }).flags, ['rushing']);
  assert.deepEqual(summarizeTiming({ biasMs: 20, stdMs: 10 }).flags, ['dragging']);
  assert.deepEqual(summarizeTiming({ biasMs: -19.9, stdMs: 20 }).flags, ['steady']);
});

test('summarizeTiming: custom cleanThresholdMs', () => {
  const { flags } = summarizeTiming({ biasMs: 0, stdMs: 15, cleanThresholdMs: 10 });
  assert.deepEqual(flags, []);
  const { flags: flags2 } = summarizeTiming({ biasMs: 0, stdMs: 15, cleanThresholdMs: 20 });
  assert.deepEqual(flags2, ['steady']);
});
