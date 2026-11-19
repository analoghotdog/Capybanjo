// Calibration: measure the input/output latency offset and jitter so timing
// scores can be corrected. See build plan C5 and Step 22.
// Pure statistics plus store-key helpers; the Calibrate view orchestrates the
// click playback and recording.

/**
 * Match user onsets to scheduled clicks and compute the mean offset and jitter.
 * @param {number[]} clickTimes seconds (AudioContext clock)
 * @param {number[]} onsetTimes seconds (recording clock, same time base when
 *   the recording is captured in the same context)
 * @returns {{ offsetMs: number, jitterMs: number, matched: number, pairs: object[] }}
 *   offsetMs: mean(onset - click) in ms (late positive).
 *   jitterMs: standard deviation of the matched offsets (sample sd).
 */
export function computeCalibration(clickTimes, onsetTimes, toleranceMs = 400) {
  const pairs = [];
  const used = new Set();
  for (const ct of clickTimes) {
    let best = -1;
    let bestDt = Infinity;
    onsetTimes.forEach((ot, i) => {
      if (used.has(i)) return;
      const dt = ot - ct;
      if (Math.abs(dt) < Math.abs(bestDt)) { bestDt = dt; best = i; }
    });
    if (best >= 0 && Math.abs(bestDt) * 1000 <= toleranceMs) {
      used.add(best);
      pairs.push({ click: ct, onset: onsetTimes[best], offsetMs: bestDt * 1000 });
    }
  }
  if (pairs.length === 0) {
    return { offsetMs: 0, jitterMs: 0, matched: 0, pairs };
  }
  const offsets = pairs.map((p) => p.offsetMs);
  const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
  const variance = offsets.length > 1
    ? offsets.reduce((a, b) => a + (b - mean) ** 2, 0) / (offsets.length - 1)
    : 0;
  return {
    offsetMs: mean,
    jitterMs: Math.sqrt(variance),
    matched: pairs.length,
    pairs,
  };
}

/** Stable store id for a device pair (input + output). */
export function calibrationKey(inputId, outputId) {
  return `cal:${inputId || 'default'}|${outputId || 'default'}`;
}

/** Human-readable warning when jitter is too high (build plan C5: ~10 ms). */
export function jitterWarning(jitterMs, thresholdMs = 10) {
  if (jitterMs <= thresholdMs) return null;
  return `Timing jitter is ${Math.round(jitterMs)} ms, above ${thresholdMs} ms. ` +
    'Wired headphones and a quieter machine usually help.';
}
