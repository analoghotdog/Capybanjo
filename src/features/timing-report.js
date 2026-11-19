// Timing report (pure logic: no DOM, no Web Audio; standard ES module).
import { alignOnsets, toleranceForExpected } from './alignment.js';

/** Sample standard deviation (n-1 denominator). Null when n < 2. */
function sampleStd(values) {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sumSq = xs.reduce((a, x) => a + (x - mean) * (x - mean), 0);
  return Math.sqrt(sumSq / (xs.length - 1));
}

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Score detected onset times against a metronome grid.
 *
 * Matching: one-to-one dynamic programming (the same algorithm as
 * alignOnsets), applied to grid times shifted by offsetMs. Each grid note gets
 * at most one onset and each onset at most one grid note; pairings outside
 * toleranceMs are impossible. DP was chosen over nearest-first greedy so the
 * assignment is globally optimal.
 *
 * deviationMs = (onset - (grid + offsetMs / 1000)) * 1000, early negative.
 * biasMs = mean of matched deviations (null when nothing matched).
 * stdMs = sample standard deviation of matched deviations (n-1 denominator;
 * null when fewer than 2 notes matched, since the n-1 estimator is undefined).
 *
 * toleranceMs defaults to the tempo-aware toleranceForExpected(grid):
 * min(250, 0.45 x the smallest gap between consecutive grid times).
 *
 * @param {number[]} onsetTimes seconds
 * @param {number[]} gridTimes seconds
 * @param {{ offsetMs?: number, toleranceMs?: number }} [options]
 */
export function scoreGrid(onsetTimes, gridTimes, options = {}) {
  const offsetMs = options.offsetMs == null ? 0 : options.offsetMs;
  const toleranceMs = options.toleranceMs == null ? toleranceForExpected(gridTimes) : options.toleranceMs;
  const onsets = Array.isArray(onsetTimes) ? onsetTimes : [];
  const grid = Array.isArray(gridTimes) ? gridTimes : [];

  // Shift the grid by the calibration offset so deviations are measured
  // relative to grid + offsetMs.
  const shiftedGrid = grid.map((t) => t + offsetMs / 1000);
  const { matches, missed, extra } = alignOnsets(onsets, shiftedGrid, { toleranceMs });

  const byGrid = new Map(matches.map((m) => [m.expectedIndex, m]));
  const notes = [];
  for (let g = 0; g < grid.length; g++) {
    const m = byGrid.get(g);
    notes.push(
      m
        ? { gridIndex: g, onsetIndex: m.detectedIndex, deviationMs: m.deviationMs }
        : { gridIndex: g, onsetIndex: null, deviationMs: null }
    );
  }

  const deviationsMs = notes
    .filter((nt) => nt.onsetIndex !== null)
    .map((nt) => nt.deviationMs);

  return {
    notes,
    deviationsMs,
    biasMs: mean(deviationsMs),
    stdMs: sampleStd(deviationsMs),
    missed: missed.length,
    extra: extra.length,
  };
}

/**
 * Evenness of roll execution per finger group.
 *
 * @param {{ notes: Array<{finger: 'T'|'I'|'M'|null}> }} tab
 * @param {Array<{expectedIndex: number, detectedIndex: number, deviationMs: number}>} matches
 *   alignOnsets-style matches (scoreGrid `notes` entries with gridIndex/onsetIndex
 *   are accepted too). expectedIndex indexes tab.notes.
 * @param {number[]} onsetTimes seconds, indexed by detectedIndex.
 * @returns {{ thumbStdMs: number|null, fingerStdMs: number|null, ioiSpreadMs: number|null }}
 *   thumbStdMs: sample std (n-1) of deviationMs over matched notes with finger 'T'.
 *   fingerStdMs: same pooled over fingers 'I' and 'M'. Notes with finger null
 *   are excluded. Null when fewer than 2 deviations are available.
 *   ioiSpreadMs: sample std (n-1) of (detected inter-onset interval minus
 *   expected inter-onset interval) in ms over consecutive matched pairs
 *   (consecutive in expectedIndex order). The expected time of a match is
 *   derived as onsetTime - deviationMs / 1000. Null when fewer than 2 pairs.
 */
export function rollEvenness(tab, matches, onsetTimes) {
  const notes = tab && Array.isArray(tab.notes) ? tab.notes : [];
  const onsets = Array.isArray(onsetTimes) ? onsetTimes : [];

  const norm = (Array.isArray(matches) ? matches : [])
    .map((m) => ({
      expectedIndex: m.expectedIndex != null ? m.expectedIndex : m.gridIndex,
      detectedIndex: m.detectedIndex != null ? m.detectedIndex : m.onsetIndex,
      deviationMs: m.deviationMs,
    }))
    .filter(
      (m) =>
        Number.isInteger(m.expectedIndex) &&
        Number.isInteger(m.detectedIndex) &&
        Number.isFinite(m.deviationMs)
    )
    .sort((a, b) => a.expectedIndex - b.expectedIndex);

  const thumb = [];
  const finger = [];
  for (const m of norm) {
    const note = notes[m.expectedIndex];
    if (!note || note.finger == null) continue;
    if (note.finger === 'T') thumb.push(m.deviationMs);
    else if (note.finger === 'I' || note.finger === 'M') finger.push(m.deviationMs);
  }

  // IOI differences over consecutive matched pairs.
  const ioiDiffsMs = [];
  for (let k = 1; k < norm.length; k++) {
    const a = norm[k - 1];
    const b = norm[k];
    const ta = onsets[a.detectedIndex];
    const tb = onsets[b.detectedIndex];
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) continue;
    const expectedA = ta - a.deviationMs / 1000;
    const expectedB = tb - b.deviationMs / 1000;
    const detectedIoi = tb - ta;
    const expectedIoi = expectedB - expectedA;
    ioiDiffsMs.push((detectedIoi - expectedIoi) * 1000);
  }

  return {
    thumbStdMs: sampleStd(thumb),
    fingerStdMs: sampleStd(finger),
    ioiSpreadMs: sampleStd(ioiDiffsMs),
  };
}

const BIAS_THRESHOLD_MS = 20;
const UNEVEN_MARGIN_MS = 10;

/**
 * Plain-language summary of a timing report. Fixed templates, no colour/emoji.
 *
 * Flags (subset of 'rushing' | 'dragging' | 'uneven-thumb' | 'steady'):
 * - rushing: biasMs <= -20
 * - dragging: biasMs >= 20
 * - uneven-thumb: thumbStdMs > fingerStdMs + 10 (both non-null)
 * - steady: |biasMs| < 20 && stdMs <= cleanThresholdMs && not uneven-thumb
 *   (steady never combines with other flags; uneven-thumb may combine with
 *   rushing or dragging).
 *
 * @param {{ biasMs: number, stdMs: number, thumbStdMs?: number|null,
 *           fingerStdMs?: number|null, ioiSpreadMs?: number|null,
 *           cleanThresholdMs?: number }} report
 * @returns {{ text: string, flags: string[] }}
 */
export function summarizeTiming(report) {
  const r = report || {};
  const biasMs = r.biasMs;
  const stdMs = r.stdMs;
  const thumbStdMs = r.thumbStdMs == null ? null : r.thumbStdMs;
  const fingerStdMs = r.fingerStdMs == null ? null : r.fingerStdMs;
  const cleanThresholdMs = r.cleanThresholdMs == null ? 20 : r.cleanThresholdMs;

  const flags = [];
  const sentences = [];

  const hasBias = Number.isFinite(biasMs);
  const hasStd = Number.isFinite(stdMs);

  if (hasBias && biasMs <= -BIAS_THRESHOLD_MS) {
    flags.push('rushing');
    sentences.push(
      `You are rushing on average by about ${Math.round(Math.abs(biasMs))} ms.`
    );
  } else if (hasBias && biasMs >= BIAS_THRESHOLD_MS) {
    flags.push('dragging');
    sentences.push(
      `You are dragging on average by about ${Math.round(Math.abs(biasMs))} ms.`
    );
  }

  const unevenThumb =
    thumbStdMs != null && fingerStdMs != null && thumbStdMs > fingerStdMs + UNEVEN_MARGIN_MS;
  if (unevenThumb) {
    flags.push('uneven-thumb');
    sentences.push('Your thumb notes are less even than your index and middle notes.');
  }

  const steady =
    hasBias &&
    hasStd &&
    Math.abs(biasMs) < BIAS_THRESHOLD_MS &&
    stdMs <= cleanThresholdMs &&
    !unevenThumb;
  if (steady) {
    flags.push('steady');
    sentences.push('Your timing is steady. Keep it up.');
  }

  if (sentences.length === 0) {
    return {
      text: 'Timing is fairly steady but not yet within the clean threshold.',
      flags,
    };
  }
  return { text: sentences.join(' '), flags };
}
